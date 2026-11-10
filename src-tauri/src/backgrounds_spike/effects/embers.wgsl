// Embers: sparks rising with flicker. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let spawn_rate = P.u_extra[0].x;
  let rise = P.u_extra[0].y;
  let flicker = P.u_extra[0].z;
  let glow = P.u_extra[0].w;

  let t = P.u_time * 0.5 * P.u_speed * (0.4 + rise);
  var col = P.u_color_b.rgb * 0.02;

  for (var layer = 0; layer < 3; layer = layer + 1) {
    let fl = f32(layer);
    let cells = 7.0 + fl * 4.0;
    var q = p * cells;
    q.x = q.x + sin(t * 0.8 + q.y * 1.2 + fl) * 0.5;
    q.y = q.y + t * (2.0 + fl * 0.8);

    let cell = floor(q);
    let local = fract(q) - vec2<f32>(0.5);
    let h = hash21(cell + vec2<f32>(fl * 21.1, P.u_seed * 0.013));
    if (h > 1.0 - spawn_rate * 0.6) {
      let d = length(local - vec2<f32>((hash11(h * 3.1) - 0.5) * 0.5, 0.0));
      let r = 0.02 + h * 0.05;
      let spark = 1.0 - smoothstep(0.0, r, d);
      let halo = exp(-(d * d) / (r * r * 12.0)) * glow;
      let flick = mix(1.0, 0.4 + 0.6 * sin(P.u_time * 9.0 * P.u_speed + h * 20.0), flicker);
      let life = smoothstep(0.0, 0.25, fract(q.y * 0.25));
      col = col + palette(fract(0.02 + h * 0.08)) * (spark + halo * 0.7) * flick * life * (0.6 + P.u_intensity) * (0.7 / (1.0 + fl * 0.5));
    }
  }

  return vec4<f32>(col, 1.0);
}
