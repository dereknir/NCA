#version 100
precision mediump float;
varying vec2 v_uv;
uniform float u_time;
uniform float u_seed;
uniform float u_pixels;
uniform vec2 u_light;
uniform float u_size;
uniform float u_ts;

uniform vec3 u_c0; uniform vec3 u_c1; uniform vec3 u_c2;
uniform vec3 u_c3; uniform vec3 u_c4; uniform vec3 u_c5;

float rand(vec2 coord) {
  coord = mod(coord, vec2(2.0, 1.0) * floor(u_size + 0.5));
  return fract(sin(dot(coord, vec2(12.9898, 78.233))) * 43758.5453 * u_seed);
}
float noise(vec2 coord) {
  vec2 i = floor(coord);
  vec2 f = fract(coord);
  float a = rand(i);
  float b = rand(i + vec2(1.0, 0.0));
  float c = rand(i + vec2(0.0, 1.0));
  float d = rand(i + vec2(1.0, 1.0));
  vec2 cubic = f * f * (3.0 - 2.0 * f);
  return mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;
}
float fbm(vec2 coord) {
  float value = 0.0;
  float scale = 0.5;
  for (int i = 0; i < 4; i++) {
    value += noise(coord) * scale;
    coord *= 2.0;
    scale *= 0.5;
  }
  return value;
}
float circleNoise(vec2 uv) {
  float uv_y = floor(uv.y);
  uv.x += uv_y * 0.31;
  vec2 f = fract(uv);
  float h = rand(vec2(floor(uv.x), floor(uv_y)));
  float m = length(f - 0.25 - (h * 0.5));
  float r = h * 0.25;
  return smoothstep(r - 0.10 * r, r, m);
}
vec2 spherify(vec2 uv) {
  vec2 centered = uv * 2.0 - 1.0;
  float z = sqrt(max(0.0001, 1.0 - dot(centered, centered)));
  vec2 sphere = centered / (z + 1.0);
  return sphere * 0.5 + 0.5;
}
bool dither(vec2 uv1, vec2 uv2) {
  return mod(uv1.x + uv2.y, 2.0 / u_pixels) <= 1.0 / u_pixels;
}
void main() {
  vec2 uv = floor(v_uv * u_pixels) / u_pixels;
  bool dith = dither(uv, uv);
  float a = step(distance(uv, vec2(0.5)), 0.5);
  vec2 suv = spherify(uv);
  float d_light = distance(suv, u_light);
  // 海
  float w = floor(max(0.0, d_light - 0.18) * 3.2);
  vec3 col = u_c0;
  if (w > 0.5) col = mix(u_c0, u_c1, 0.5);
  if (w > 1.5) col = u_c1;
  // 陸
  float land = fbm(suv * u_size + vec2(u_seed * 3.1 + u_time * u_ts, u_seed));
  if (land > 0.56) {
    float lp = floor(max(0.0, d_light - 0.18) * 3.2);
    col = u_c2;
    if (lp > 0.5) col = mix(u_c2, u_c3, 0.6);
    if (lp > 1.5) col = u_c3;
  }
  // 雲(隨時間漂移)
  float cl = fbm(suv * u_size * 1.4 + vec2(u_time * u_ts * 2.0, u_seed * 7.0));
  if (cl > 0.55) {
    col = (d_light < 0.5) ? u_c5 : u_c4;
    if (dith && cl < 0.60) col = mix(col, u_c1, 0.4);
  }
  if (dith) col *= 1.04;
  gl_FragColor = vec4(col, a);
}
