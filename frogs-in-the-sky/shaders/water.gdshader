shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

uniform vec3 shallow : source_color = vec3(0.62, 0.96, 0.95);
uniform vec3 deep : source_color = vec3(0.22, 0.62, 0.78);
uniform float alpha_v = 0.78;
uniform float glow = 0.35;

void vertex() {
	VERTEX.y += sin(TIME * 1.3 + VERTEX.x * 3.0) * 0.012 + cos(TIME * 1.1 + VERTEX.z * 2.5) * 0.012;
}

void fragment() {
	vec3 wp = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float w = sin(wp.x * 5.0 + TIME * 1.2) * 0.5 + sin(wp.z * 6.0 - TIME * 0.9) * 0.5;
	float sparkle = pow(max(0.0, sin(wp.x * 17.0 + TIME * 2.0) * sin(wp.z * 13.0 - TIME * 1.7)), 12.0);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	ALBEDO = mix(deep, shallow, 0.55 + 0.25 * w);
	EMISSION = shallow * glow + vec3(sparkle) * 0.8 + vec3(fres) * 0.25;
	ROUGHNESS = 0.04;
	SPECULAR = 0.9;
	NORMAL_MAP = normalize(vec3(0.5 + 0.06 * w, 0.5 + 0.06 * cos(wp.x * 4.0 + TIME), 1.0));
	ALPHA = clamp(alpha_v + fres * 0.2, 0.0, 1.0);
}
