// SDF shapes: morphing signed-distance shapes. Tier 0, stateless.

fn rot(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(p.x * c - p.y * s, p.x * s + p.y * c);
}

fn sd_circle(p: vec2<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sd_box(p: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(p) - b;
  return length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
}

fn sd_triangle(p: vec2<f32>, r: f32) -> f32 {
  let k = 1.7320508;
  var q = vec2<f32>(abs(p.x) - r, -p.y);
  if (q.x + k * q.y > 0.0) {
    q = vec2<f32>(q.x - k * q.y, -k * q.x - q.y) * 0.5;
  }
  q.x = q.x - clamp(q.x, -2.0 * r, 0.0);
  return -length(q) * sign(q.y);
}

fn sd_hexagon(p: vec2<f32>, r: f32) -> f32 {
  let k = vec3<f32>(-0.8660254, 0.5, 0.57735);
  var q = abs(p);
  let a = 2.0 * min(k.x * q.x + k.y * q.y, 0.0);
  q = q - vec2<f32>(a * k.x, a * k.y);
  q = q - vec2<f32>(clamp(q.x, -k.z * r, k.z * r), r);
  return length(q) * sign(q.y);
}

fn sd_star(p: vec2<f32>, r: f32) -> f32 {
  let k = vec2<f32>(0.809016, 0.587785);
  var q = vec2<f32>(abs(p.x), p.y);
  var d = 0.0;
  if (q.x * k.y - q.y * k.x > 0.0) {
    q.x = q.x * k.y - q.y * k.x;
    q.y = q.x * k.x + q.y * k.y;
  }
  q.x = q.x - clamp(q.x, 0.35 * r, r);
  d = length(q - vec2<f32>(0.0, 0.35 * r)) * sign(q.y - 0.35 * r);
  return d;
}

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res);

  let shape = i32(P.u_extra[0].x);
  let morph = P.u_extra[0].y;
  let glow = P.u_extra[0].z;
  let spin = P.u_extra[0].w;

  let t = P.u_time * 0.3 * P.u_speed;
  let r = 0.22 + P.u_scale * 0.12;
  let q = rot(p, t * spin * 2.0);
  let breathe = 1.0 + sin(t * 2.0) * morph * 0.18;

  var d = sd_circle(q, r * breathe);
  if (shape == 1) {
    d = sd_box(q, vec2<f32>(r, r * 0.7) * breathe);
  } else if (shape == 2) {
    d = sd_triangle(q * vec2<f32>(1.0, -1.0), r * 1.25 * breathe);
  } else if (shape == 3) {
    d = sd_hexagon(q, r * breathe);
  } else if (shape == 4) {
    d = sd_star(q, r * breathe);
  } else if (shape == 5) {
    let a = sd_circle(q, r * breathe);
    let b = sd_box(rot(q, 0.785398), vec2<f32>(r * 0.85) * breathe);
    d = mix(a, b, 0.5 + 0.5 * sin(t * 1.6 + morph * 3.0));
  }

  let fill = 1.0 - smoothstep(0.0, 0.02, d);
  let ring = exp(-abs(d) * (14.0 - glow * 8.0)) * (0.3 + glow);
  let halo = exp(-max(d, 0.0) * 4.0) * 0.25 * glow;

  var col = P.u_color_a.rgb * 0.03;
  col = col + palette(fract(0.55 + morph * 0.3)) * (ring + halo) * (0.6 + P.u_intensity);
  col = col + palette(fract(0.6 + t * 0.05)) * fill * 0.12;
  return vec4<f32>(col, 1.0);
}
