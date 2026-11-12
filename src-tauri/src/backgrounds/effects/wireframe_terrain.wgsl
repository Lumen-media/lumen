// Wireframe terrain: perspective grid landscape. Tier 0, stateless.

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let p = aspect_correct(uv);

  let amplitude = P.u_extra[0].x;
  let grid_size = P.u_extra[0].y;
  let fog = P.u_extra[0].z;
  let scroll = P.u_extra[0].w;

  let t = P.u_time * P.u_speed * (0.15 + scroll * 0.5);
  let horizon = 0.12;
  let depth = 1.0 / max(uv.y - horizon, 0.02);

  var col = mix(P.u_color_b.rgb * 0.05, P.u_color_a.rgb * 0.1, uv.y);
  if (uv.y < horizon) {
    let sky = smoothstep(horizon, 1.0, uv.y);
    return vec4<f32>(mix(P.u_color_b.rgb * 0.12, P.u_color_a.rgb * 0.03, sky), 1.0);
  }

  let world_x = p.x * depth * (0.8 + grid_size * 0.02);
  let world_z = depth * 2.0 + t;

  let height = (value_noise(vec2<f32>(world_x * 0.5, world_z * 0.5)) - 0.5) * amplitude * 2.0;
  let ridge = height * 0.5 + 0.5;

  let gx = abs(fract(world_x * 0.5) - 0.5) * 2.0;
  let gz = abs(fract(world_z * 0.5) - 0.5) * 2.0;
  let lines = smoothstep(0.92, 1.0, max(gx, gz));

  let fade = exp(-depth * (0.15 + fog * 0.5));
  var terrain = palette(fract(0.55 + ridge * 0.3)) * lines * fade * (0.5 + P.u_intensity);
  terrain = terrain + palette(fract(0.5 + height * 0.3)) * ridge * 0.12 * fade;

  col = col + terrain;
  col = col + palette(fract(0.7)) * smoothstep(0.02, 0.0, abs(uv.y - horizon)) * 0.4;
  return vec4<f32>(col, 1.0);
}
