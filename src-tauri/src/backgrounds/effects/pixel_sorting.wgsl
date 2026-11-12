// Pixel sorting: brightness-thresholded rows/columns pulled and reseeded. Tier 1.

@group(0) @binding(1) var prev_tex: texture_2d<f32>;
@group(0) @binding(2) var prev_sampler: sampler;

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;

  let threshold = P.u_extra[0].x;
  let direction = i32(P.u_extra[0].y);
  let sort_speed = P.u_extra[0].z;

  let t = P.u_time * P.u_speed;
  var axis = vec2<f32>(1.0, 0.0);
  if (direction == 1) {
    axis = vec2<f32>(0.0, 1.0);
  }

  let row = floor(dot(uv, axis) * 96.0);
  let h = hash21(vec2<f32>(row, floor(t * 2.0)));

  var col = textureSample(prev_tex, prev_sampler, uv).rgb;
  let luma = dot(col, vec3<f32>(0.299, 0.587, 0.114));

  if (luma > threshold * 0.75 && h > 0.4) {
    let shift = (h - 0.5) * 0.5 * (0.3 + sort_speed);
    var best = luma;
    var best_col = col;
    for (var i = 0; i < 6; i = i + 1) {
      let fi = f32(i) - 3.0;
      let sample_uv = uv + axis * (shift * fi * 0.05);
      let sample_col = textureSample(prev_tex, prev_sampler, clamp(sample_uv, vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
      let sample_luma = dot(sample_col, vec3<f32>(0.299, 0.587, 0.114));
      if (sample_luma > best) {
        best = sample_luma;
        best_col = sample_col;
      }
    }
    col = mix(col, best_col, sort_speed * 0.8);
  }

  // Inject fresh energy so the field never collapses.
  let pulse = smoothstep(0.02, 0.0, abs(fract(uv.x * 1.7 + t * 0.15) - 0.5));
  col = col * 0.985 + palette(fract(0.5 + uv.y * 0.3 + t * 0.05)) * pulse * 0.4 * (0.5 + P.u_intensity);
  col = col + P.u_color_a.rgb * 0.004;
  return vec4<f32>(col, 1.0);
}
