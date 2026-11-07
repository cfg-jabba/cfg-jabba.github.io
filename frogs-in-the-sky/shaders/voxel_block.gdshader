shader_type spatial;
render_mode diffuse_burley;
// World-space voxel look for architecture: per-cell colour jitter, bevel darkening, moss growth.

uniform vec3 base_color : source_color = vec3(0.72, 0.71, 0.68);
uniform vec3 alt_color : source_color = vec3(0.62, 0.6, 0.58);
uniform vec3 moss_color : source_color = vec3(0.33, 0.47, 0.2);
uniform float density = 4.0;
uniform float jitter = 0.08;
uniform float alt_amount = 0.25;
uniform float moss = 0.3;
uniform float roughness_v = 0.9;
uniform float metallic_v = 0.0;
uniform float stripes = 0.0;

varying vec3 wpos;
varying vec3 wnrm;

float h3(vec3 p) {
	p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 n = wnrm;
	vec3 an = abs(n);
	vec3 p = wpos * density - n * 0.01;
	vec3 cell = floor(p);
	vec3 f = fract(p);
	vec2 t;
	if (an.y > an.x && an.y > an.z) { t = f.xz; } else if (an.x > an.z) { t = f.zy; } else { t = f.xy; }
	float edge = min(min(t.x, 1.0 - t.x), min(t.y, 1.0 - t.y));
	float bevel = smoothstep(0.0, 0.08, edge);
	float r = h3(cell);
	float big = vnoise(cell * 0.21);
	vec3 col = mix(base_color, alt_color, clamp(step(1.0 - alt_amount, r) + big * 0.35, 0.0, 1.0));
	col *= 1.0 + (r - 0.5) * jitter * 2.0;
	if (stripes > 0.5) {
		float s = step(0.5, fract((cell.x + cell.z) * 0.25));
		col = mix(col, alt_color, s);
	}
	float mn = vnoise(cell * 0.33 + vec3(4.0));
	float mmask = smoothstep(1.0 - moss, 1.0 - moss + 0.12, mn * 0.8 + max(n.y, 0.0) * 0.35);
	mmask *= step(-0.3, n.y);
	vec3 mc = moss_color * (0.8 + h3(cell + 3.1) * 0.4);
	col = mix(col, mc, mmask);
	// darker grime towards the underside of everything
	col *= mix(0.82, 1.0, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
	col *= mix(0.88, 1.0, bevel);
	ALBEDO = col;
	ROUGHNESS = mix(roughness_v, 0.95, mmask);
	METALLIC = metallic_v * (1.0 - mmask);
}
