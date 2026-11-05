// Fullscreen triangle from gl_VertexID; no vertex buffer is needed.

@vertex
fn main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vertex_index << 1u) & 2u);
  let y = f32(vertex_index & 2u);
  return vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}
