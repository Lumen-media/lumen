import { BACKGROUND_BUNDLE } from './generated/catalog';
import { hexToRgba, paramSpecs } from './params';
import type { EffectRuntime, ParamValue } from './types';

/** Per-frame inputs the layer feeds the renderer. */
export interface FrameState {
  time: number;
  dt: number;
  speed: number;
  seed: number;
  params: Record<string, ParamValue>;
}

export interface GlEngineOptions {
  resolutionScale?: number;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const INVALID_INDEX = 0xffffffff;
const MAX_DPR = 2;

interface ProgramInfo {
  program: WebGLProgram;
  sampler: WebGLUniformLocation | null;
}

interface FeedbackTargets {
  textures: [WebGLTexture, WebGLTexture];
  framebuffers: [WebGLFramebuffer, WebGLFramebuffer];
  size: number;
  read: 0 | 1;
  write: 0 | 1;
}

/**
 * Executes one effect on a canvas.
 *
 * Effect definitions, parameters, uniform packing and shader sources all come
 * from Rust; this class only owns WebGL state and the draw calls.
 */
export class GlEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly effect: EffectRuntime;
  private readonly uniforms: Float32Array;
  private readonly onContextLost?: () => void;
  private readonly onContextRestored?: () => void;

  private ubo: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private main: ProgramInfo | null = null;
  private display: ProgramInfo | null = null;
  private programs: WebGLProgram[] = [];
  private feedback: FeedbackTargets | null = null;

  private resolutionScale: number;
  private lost = false;
  private disposed = false;

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.lost = true;
    this.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.lost = false;
    try {
      this.initResources();
      this.onContextRestored?.();
    } catch {
      this.onContextLost?.();
    }
  };

  constructor(canvas: HTMLCanvasElement, effect: EffectRuntime, options: GlEngineOptions = {}) {
    this.canvas = canvas;
    this.effect = effect;
    this.resolutionScale = options.resolutionScale ?? 1;
    this.onContextLost = options.onContextLost;
    this.onContextRestored = options.onContextRestored;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      desynchronized: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is not available');
    }
    this.gl = gl;
    this.uniforms = new Float32Array(BACKGROUND_BUNDLE.layout.floatCount);

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.initResources();
  }

  /** Sets the render resolution multiplier (0.5 = half of the CSS pixels). */
  setResolutionScale(scale: number): void {
    this.resolutionScale = Math.min(1, Math.max(0.25, scale));
  }

  /** Sizes the drawing buffer from the element box, DPR and resolution scale. */
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    const width = Math.max(1, Math.round(cssWidth * Math.min(dpr, MAX_DPR) * this.resolutionScale));
    const height = Math.max(
      1,
      Math.round(cssHeight * Math.min(dpr, MAX_DPR) * this.resolutionScale)
    );

    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  render(frame: FrameState): void {
    if (this.lost || this.disposed || !this.main || !this.ubo || !this.vao) {
      return;
    }

    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width === 0 || height === 0) {
      return;
    }

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);

    if (this.effect.tier === 0 || !this.display) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      this.writeUniforms(frame, width, height);
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is the WebGL API, not a React hook.
      gl.useProgram(this.main.program);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    const targets = this.ensureFeedback();

    // Simulation pass: read the previous frame, write the next one.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.framebuffers[targets.write]);
    gl.viewport(0, 0, targets.size, targets.size);
    this.writeUniforms(frame, targets.size, targets.size);
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is the WebGL API, not a React hook.
    gl.useProgram(this.main.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.textures[targets.read]);
    if (this.main.sampler) gl.uniform1i(this.main.sampler, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Display pass: stretch the fresh target to the surface.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    this.writeUniforms(frame, width, height);
    // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is the WebGL API, not a React hook.
    gl.useProgram(this.display.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets.textures[targets.write]);
    if (this.display.sampler) gl.uniform1i(this.display.sampler, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    targets.read = targets.write;
    targets.write = targets.write === 0 ? 1 : 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.releaseResources();
    // Deleting resources does not release the context itself: the browser only
    // reclaims it on GC, and there is a hard cap (~16) of live contexts. One
    // context per surface means opening and closing dialogs would eventually
    // evict the context of a surface that is still on screen, freezing it.
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private initResources(): void {
    const gl = this.gl;
    this.releaseResources();

    this.vao = gl.createVertexArray();
    this.ubo = gl.createBuffer();
    if (!this.vao || !this.ubo) {
      throw new Error('Could not allocate WebGL buffers');
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, this.uniforms.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);

    const pass = this.effect.passes[0];
    this.main = this.createProgram(
      BACKGROUND_BUNDLE.vertex.glsl,
      pass.glsl,
      pass.uniformBlock,
      pass.samplerUniform
    );

    if (this.effect.tier > 0) {
      const display = BACKGROUND_BUNDLE.display;
      this.display = this.createProgram(
        BACKGROUND_BUNDLE.vertex.glsl,
        display.glsl,
        display.uniformBlock,
        display.samplerUniform
      );
    }
  }

  private releaseResources(): void {
    for (const program of this.programs) {
      this.gl.deleteProgram(program);
    }
    this.programs = [];
    this.main = null;
    this.display = null;

    if (this.feedback) {
      this.deleteFeedback(this.feedback);
      this.feedback = null;
    }
    if (this.ubo) {
      this.gl.deleteBuffer(this.ubo);
      this.ubo = null;
    }
    if (this.vao) {
      this.gl.deleteVertexArray(this.vao);
      this.vao = null;
    }
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string,
    blockName: string,
    samplerName: string | null
  ): ProgramInfo {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Could not create WebGL program');
    }

    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Generator program failed to link: ${log}`);
    }

    const blockIndex = gl.getUniformBlockIndex(program, blockName);
    if (blockIndex === INVALID_INDEX) {
      gl.deleteProgram(program);
      throw new Error(`Generator program is missing uniform block "${blockName}"`);
    }
    gl.uniformBlockBinding(program, blockIndex, 0);

    const sampler = samplerName ? gl.getUniformLocation(program, samplerName) : null;
    this.programs.push(program);
    return { program, sampler };
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Could not create WebGL shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
      gl.deleteShader(shader);
      throw new Error(`Generator shader failed to compile: ${log}`);
    }
    return shader;
  }

  private writeUniforms(frame: FrameState, width: number, height: number): void {
    const gl = this.gl;
    const layout = BACKGROUND_BUNDLE.layout;
    const uniforms = this.uniforms;
    uniforms.fill(0);

    const param = (key: string, fallback: number): number => {
      const value = frame.params[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };

    uniforms[layout.time] = frame.time;
    uniforms[layout.dt] = frame.dt;
    uniforms[layout.resolution] = width;
    uniforms[layout.resolution + 1] = height;
    uniforms[layout.seed] = frame.seed;
    uniforms[layout.speed] = param('speed', 1);
    uniforms[layout.scale] = param('scale', 1);
    uniforms[layout.intensity] = param('intensity', 1);
    uniforms.set(hexToRgba(String(frame.params.colorA ?? '#4f7cff')), layout.colorA);
    uniforms.set(hexToRgba(String(frame.params.colorB ?? '#ff5fa2')), layout.colorB);

    for (const spec of paramSpecs(this.effect)) {
      if (spec.uniformIndex < layout.extra) continue;
      const value = frame.params[spec.key];
      if (typeof value === 'number') {
        uniforms[spec.uniformIndex] = value;
      } else if (typeof value === 'boolean') {
        uniforms[spec.uniformIndex] = value ? 1 : 0;
      }
    }

    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, uniforms);
  }

  private ensureFeedback(): FeedbackTargets {
    const size = Math.max(
      64,
      Math.min(512, Math.min(this.canvas.width || 512, this.canvas.height || 512))
    );
    if (this.feedback && this.feedback.size === size) {
      return this.feedback;
    }
    if (this.feedback) {
      this.deleteFeedback(this.feedback);
    }

    const textures: [WebGLTexture, WebGLTexture] = [
      this.createFeedbackTexture(size),
      this.createFeedbackTexture(size),
    ];
    const framebuffers: [WebGLFramebuffer, WebGLFramebuffer] = [
      this.createFeedbackFramebuffer(textures[0]),
      this.createFeedbackFramebuffer(textures[1]),
    ];

    this.feedback = { textures, framebuffers, size, read: 0, write: 1 };
    return this.feedback;
  }

  private createFeedbackTexture(size: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error('Could not create feedback texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private createFeedbackFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      throw new Error('Could not create feedback framebuffer');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      throw new Error('Feedback framebuffer is incomplete');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  private deleteFeedback(targets: FeedbackTargets): void {
    for (const framebuffer of targets.framebuffers) {
      this.gl.deleteFramebuffer(framebuffer);
    }
    for (const texture of targets.textures) {
      this.gl.deleteTexture(texture);
    }
  }
}
