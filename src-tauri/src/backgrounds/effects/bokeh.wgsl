// Bokeh: large out-of-focus circles. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.5);

  let count = i32(P.u_extra[0].x);
  let size = P.u_extra[0].y;
  let blur = P.u_extra[0].z;
  let drift = P.u_extra[0].w;

  let t = P.u_time * 0.08 * P.u_speed * (0.3 + drift);
  var col = P.u_color_a.rgb * 0.02;

  for (var i = 0; i < 32; i = i + 1) {
    if (i >= count) {
      break;
    }
    let fi = f32(i) + 1.0;
    let ang = hash11(fi * 12.9898 + P.u_seed * 0.013) * 6.28318;
    let speed = 0.4 + hash11(fi * 4.71) * 0.8;
    let center = vec2<f32>(
      cos(ang + t * speed) * (0.3 + hash11(fi * 3.3) * 0.7),
      sin(ang * 1.7 + t * speed * 0.8) * (0.3 + hash11(fi * 8.1) * 0.7),
    );
    let r = (0.04 + size * 0.14) * (0.6 + hash11(fi * 6.7));
    let d = length(p - center);
    let disc = 1.0 - smoothstep(r * (1.0 - blur * 0.5), r * (1.0 + blur * 0.6), d);
    let rim = smoothstep(r * 0.7, r, d) * disc * 0.5;
    col = col + palette(fract(0.15 + fi * 0.13)) * (disc * 0.5 + rim) * (0.35 + P.u_intensity * 0.5);
  }

  return vec4<f32>(col, 1.0);
}
