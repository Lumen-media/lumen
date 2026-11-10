// Glitch: block displacement and RGB split. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;

  let amount = P.u_extra[0].x;
  let block_size = P.u_extra[0].y;
  let rgb_split = P.u_extra[0].z;
  let rate = P.u_extra[0].w;

  let t = P.u_time * P.u_speed * (0.5 + rate * 3.0);
  let tick = floor(t * 4.0);

  let block = floor(uv * (vec2<f32>(res.x / max(res.y, 1.0), 1.0) * (8.0 + block_size * 6.0)));
  let h = hash21(block + vec2<f32>(tick * 0.37, tick * 0.11));
  let band = floor(uv.y * (6.0 + block_size * 4.0));
  let bh = hash21(vec2<f32>(band, tick));

  var shifted = uv;
  if (bh > 0.72 - amount * 0.3) {
    shifted.x = shifted.x + (h - 0.5) * 0.18 * amount;
  }

  let p = aspect_correct(shifted) * (0.9 + P.u_scale * 0.7);
  let split = 0.004 + rgb_split * 0.02;

  let base = palette(fract(0.55 + value_noise(p * 3.0 + vec2<f32>(t * 0.3, 0.0)) * 0.4 + shifted.y * 0.2));
  let r = palette(fract(0.55 + value_noise((p + vec2<f32>(split, 0.0)) * 3.0 + vec2<f32>(t * 0.3, 0.0)) * 0.4)).r;
  let b = palette(fract(0.55 + value_noise((p - vec2<f32>(split, 0.0)) * 3.0 + vec2<f32>(t * 0.3, 0.0)) * 0.4)).b;

  var col = vec3<f32>(mix(base.r, r, rgb_split), base.g, mix(base.b, b, rgb_split));
  col = col * (0.55 + P.u_intensity * 0.7);

  let scan = step(0.5, fract(shifted.y * res.y * 0.4 - t * 8.0));
  col = col * mix(1.0, 0.82 + scan * 0.18, amount);
  col = col + vec3<f32>(h * 0.08, 0.0, bh * 0.1) * amount;
  return vec4<f32>(col, 1.0);
}
