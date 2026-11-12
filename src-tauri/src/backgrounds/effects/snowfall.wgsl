// Snowfall: soft layered flakes drifting with wind. Tier 0, stateless.

// Soft-edged disc: a feathered core plus a faint halo, so near flakes read as
// slightly out of focus instead of hard dots on a lattice.
fn snow_flake(d: f32, r: f32, blur: f32) -> f32 {
  let feather = mix(0.7, 0.12, clamp(blur, 0.0, 1.0));
  let core = 1.0 - smoothstep(r * feather, r, d);
  let halo = exp(-(d * d) / max(r * r * (3.0 + blur * 9.0), 0.00001)) * (0.12 + blur * 0.3);
  return core + halo;
}

@fragment
fn main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let res = max(P.u_resolution, vec2<f32>(1.0, 1.0));
  let p = aspect_correct(frag.xy / res) * (0.9 + P.u_scale * 0.7);

  let density = clamp(P.u_extra[0].x, 0.0, 1.0);
  let wind = P.u_extra[0].y;
  let size = clamp(P.u_extra[0].z, 0.0, 1.0);
  let blur = clamp(P.u_extra[0].w, 0.0, 1.0);

  let t = P.u_time * 0.45 * P.u_speed;
  let flake_tint = mix(vec3<f32>(1.0), P.u_color_a.rgb, 0.18);
  var col = mix(P.u_color_b.rgb, P.u_color_a.rgb, 0.5) * 0.025;

  // Four depth layers: 0 is closest (big, soft, fast), 3 is farthest.
  for (var layer = 0; layer < 4; layer = layer + 1) {
    let fl = f32(layer);

    // Rotating each layer keeps the grids from lining up into a visible mesh.
    let a = 0.4 + fl * 0.51;
    let ca = cos(a);
    let sa = sin(a);
    let rot = vec2<f32>(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

    // More cells with depth: far flakes are smaller and more numerous.
    let cells = 9.0 + density * 16.0 + fl * fl * 7.0;
    var q = rot * cells;

    // Wind drifts flakes sideways, a touch faster on the near layers.
    q.x = q.x + wind * t * cells * 0.15 * (0.7 + fl * 0.15);

    // Curling fall path: broad sway from the air plus a per-flake wobble below.
    let air = sin(t * 0.8 + fl * 1.9 + rot.y * 1.7) * 0.45 + sin(t * 1.6 + rot.x * 2.3 + fl) * 0.2;
    q.x = q.x + air;

    // Fall speed varies per screen column; without that every flake drops in
    // lockstep and the whole field looks mechanical.
    let column = 0.72 + 0.55 * value_noise(vec2<f32>(q.x * 0.035, fl * 9.0));
    q.y = q.y + t * cells * 0.16 * (1.15 - fl * 0.2) * column;

    let cell = floor(q);
    let local = fract(q);
    let h = hash21(cell + vec2<f32>(fl * 19.1, P.u_seed * 0.013));

    // Leave gaps: real snow is uneven, not a full lattice.
    let threshold = 0.18 + (1.0 - density) * 0.4;
    if (h > threshold) {
      let jitter = (vec2<f32>(hash11(h * 4.3), hash11(h * 8.7)) - vec2<f32>(0.5)) * 0.6;
      let wobble = vec2<f32>(sin(t * 1.3 + h * 47.0) * 0.1, cos(t * 1.1 + h * 31.0) * 0.05);
      let d = length(local - vec2<f32>(0.5) - jitter - wobble);

      // Bigger, brighter, softer flakes in front sell the depth.
      let r = (0.1 + size * 0.35) * (0.55 + h * 0.75) * (1.0 - fl * 0.13);
      let shape = snow_flake(d, r, blur + fl * 0.06);
      let depth_light = (1.0 - fl * 0.17) * (0.65 + h * 0.5);
      col = col + flake_tint * shape * depth_light * (0.55 + P.u_intensity * 0.7);
    }
  }

  return vec4<f32>(col, 1.0);
}
