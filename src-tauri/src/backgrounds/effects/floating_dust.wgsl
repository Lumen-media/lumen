// Floating dust: slow drifting motes. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let density = P.u_extra[0].x;
  let size = P.u_extra[0].y;
  let drift = P.u_extra[0].z;
  let bokeh = P.u_extra[0].w;

  let t = P.u_time * 0.12 * P.u_speed * (0.3 + drift);
  var col = P.u_color_a.rgb * 0.02;

  for (var layer = 0; layer < 3; layer = layer + 1) {
    let fl = f32(layer);
    let cells = 6.0 + density * 14.0 + fl * 4.0;
    var q = p * cells;
    q.x = q.x + t * (0.8 + fl * 0.4) + sin(t * 0.9 + q.y * 0.5) * 0.6;
    q.y = q.y - t * (0.5 + fl * 0.6) + cos(t * 0.7 + q.x * 0.4) * 0.6;

    let cell = floor(q);
    let local = fract(q) - vec2<f32>(0.5);
    let h = hash21(cell + vec2<f32>(fl * 19.3, P.u_seed * 0.007));
    if (h > 0.3) {
      let offset = (vec2<f32>(hash11(h * 3.9), hash11(h * 7.7)) - vec2<f32>(0.5)) * 0.6;
      let d = length(local - offset);
      let r = (0.03 + size * 0.08) * (0.5 + h * 0.8);
      let core = 1.0 - smoothstep(r * 0.6, r, d);
      let halo = exp(-(d * d) / (r * r * (6.0 + bokeh * 20.0))) * bokeh;
      col = col + palette(fract(0.55 + h * 0.15)) * (core + halo * 0.6) * (0.5 / (1.0 + fl * 0.6)) * (0.45 + P.u_intensity);
    }
  }

  return vec4<f32>(col, 1.0);
}
