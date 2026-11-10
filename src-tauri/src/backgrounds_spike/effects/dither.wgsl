// Dither: ordered dithering of a gradient field. Tier 0, stateless.

fn bayer4(cell: vec2<f32>) -> f32 {
  let x = i32(cell.x) % 4;
  let y = i32(cell.y) % 4;
  // 4x4 ordered dither matrix, index packed per row.
  var row = vec4<f32>(0.0, 8.0, 2.0, 10.0);
  if (y == 1) {
    row = vec4<f32>(12.0, 4.0, 14.0, 6.0);
  } else if (y == 2) {
    row = vec4<f32>(3.0, 11.0, 1.0, 9.0);
  } else if (y == 3) {
    row = vec4<f32>(15.0, 7.0, 13.0, 5.0);
  }
  var value = 0.0;
  if (x == 0) {
    value = row.x;
  } else if (x == 1) {
    value = row.y;
  } else if (x == 2) {
    value = row.z;
  } else {
    value = row.w;
  }
  return (value + 0.5) / 16.0;
}

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let uv = frag.xy / res;
  let p = aspect_correct(uv) * (0.9 + P.u_scale * 0.7);

  let pattern = i32(P.u_extra[0].x);
  let pixel_scale = P.u_extra[0].y;
  let threshold = P.u_extra[0].z;
  let animate = P.u_extra[0].w;

  let t = P.u_time * 0.4 * P.u_speed * animate;
  let shade = 0.5 + 0.5 * sin(p.x * 3.0 + p.y * 2.0 + t);

  let cell = floor(frag.xy / max(pixel_scale, 1.0));
  var limit = bayer4(cell);
  if (pattern == 1) {
    limit = fract(sin(dot(cell, vec2<f32>(12.9898, 78.233)) + t) * 43758.5453);
  } else if (pattern == 2) {
    limit = fract((cell.x + cell.y) * 0.5 + t * 0.1);
  } else if (pattern == 3) {
    limit = fract(cell.y * 0.5 + t * 0.2);
  }

  let lit = step(limit, shade + (threshold - 0.5) * 0.6);
  let tint = palette(fract(0.5 + shade * 0.4));
  var col = mix(P.u_color_a.rgb * 0.08, tint, lit);
  col = col * (0.6 + P.u_intensity * 0.7);
  return vec4<f32>(col, 1.0);
}
