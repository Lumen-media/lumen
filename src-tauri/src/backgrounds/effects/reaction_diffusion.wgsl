// Reaction diffusion: organic Turing patterns on a small feedback field. Tier 1.

@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let texel = vec2<f32>(1.0, 1.0) / res;

  let feed = P.u_extra[0].x;
  let kill = P.u_extra[0].y;
  let diffusion_a = P.u_extra[0].z;
  let diffusion_b = P.u_extra[0].w;

  let center = textureSample(prev_tex, prev_sampler, uv);
  var a = center.r;
  var b = center.g;

  var la = 0.0;
  var lb = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    var dir = vec2<f32>(1.0, 0.0);
    if (i == 1) {
      dir = vec2<f32>(-1.0, 0.0);
    } else if (i == 2) {
      dir = vec2<f32>(0.0, 1.0);
    } else if (i == 3) {
      dir = vec2<f32>(0.0, -1.0);
    }
    let sample_col = textureSample(prev_tex, prev_sampler, uv + dir * texel * 1.6).rg;
    la = la + sample_col.r;
    lb = lb + sample_col.g;
  }
  la = la * 0.25 - a;
  lb = lb * 0.25 - b;

  let t = P.u_time * P.u_speed;
  let rate = 1.0;
  let reaction = a * b * b;
  a = clamp(a + (diffusion_a * la - reaction + feed * (1.0 - a)) * rate, 0.0, 1.0);
  b = clamp(b + (diffusion_b * lb + reaction - (kill + feed) * b) * rate, 0.0, 1.0);

  // Seeded nucleus so patterns start quickly and never die out.
  let nucleus = smoothstep(0.06, 0.0, length(uv - vec2<f32>(0.5 + 0.2 * sin(t * 0.2), 0.5 + 0.2 * cos(t * 0.17))));
  b = max(b, nucleus * 0.8);

  let v = smoothstep(0.1, 0.6, b);
  var col = mix(P.u_color_a.rgb * 0.08, palette(fract(0.55 + a * 0.35)), v);
  col = col * (0.6 + P.u_intensity * 0.8);
  return vec4<f32>(col, 1.0);
}
