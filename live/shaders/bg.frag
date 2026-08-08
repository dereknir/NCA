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
  float n = fbm(uv * u_size + u_seed) * 0.7
          + fbm(uv * u_size * 2.6 + u_seed * 7.0) * 0.4;
  vec3 col = u_c4;                       // 深空底
  if (n > 0.50) col = u_c3;
  if (n > 0.60) col = u_c2;
  if (n > 0.69) col = u_c1;
  if (n > 0.77) col = u_c0;
  if (dith && n > 0.47) col = mix(col, u_c3, 0.45);
  // 星點:格點雜湊
  float s1 = rand(uv * 61.0);
  if (s1 > 0.994) col = mix(u_c5, vec3(1.0), step(0.998, s1));
  gl_FragColor = vec4(col, 1.0);
}
