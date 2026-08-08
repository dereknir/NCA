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
  vec2 c0 = uv - 0.5;
  // 環空間:傾斜 + 壓扁
  float ang = -0.42;
  vec2 r0 = vec2(c0.x * cos(ang) - c0.y * sin(ang), c0.x * sin(ang) + c0.y * cos(ang));
  vec2 rr = vec2(r0.x, r0.y * 3.4);
  float rd = length(rr);
  bool inRing = rd > 0.36 && rd < 0.50;
  bool ringFront = r0.y > 0.0;
  float pr = 0.30;
  bool inPlanet = length(c0) < pr;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  if (inPlanet) {
    vec2 puv = c0 / (pr * 2.0) + 0.5;
    vec2 suv = spherify(puv);
    float d_light = distance(suv, u_light);
    float band = fbm(vec2(suv.x * u_size * 0.5 + u_time * u_ts, suv.y * u_size * 3.0));
    float c = band * (0.15 + d_light) * 2.4;
    if (dith) c *= 1.06;
    float p = floor(c * 4.0);
    col = u_c0;
    if (p > 0.5) col = u_c1;
    if (p > 1.5) col = u_c2;
    if (p > 2.5) col = u_c3;
    alpha = 1.0;
  }
  if (inRing && (ringFront || !inPlanet)) {
    float rb = fbm(vec2(rd * 34.0, atan(rr.y, rr.x) * 1.2) + u_seed);
    float d_light2 = distance(uv, u_light);
    vec3 rcol = mix(u_c4, u_c5, step(0.5, rb));
    rcol *= 1.0 - d_light2 * 0.4;
    if (dith) rcol *= 1.05;
    float ra = smoothstep(0.36, 0.375, rd) * (1.0 - smoothstep(0.485, 0.50, rd));
    if (rb > 0.25) { col = rcol; alpha = max(alpha, ra); }
    else if (!inPlanet) { alpha = max(alpha, 0.0); }
  }
  gl_FragColor = vec4(col, alpha);
}
