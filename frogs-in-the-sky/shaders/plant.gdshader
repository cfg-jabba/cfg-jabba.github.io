shader_type spatial;
render_mode cull_disabled, diffuse_burley;

uniform float sway = 0.07;
uniform float speed = 1.1;

void vertex() {
	vec3 wp = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float h = abs(VERTEX.y);
	float s = sin(TIME * speed + wp.x * 0.6 + wp.z * 0.4) + 0.5 * sin(TIME * speed * 2.3 + wp.z * 1.3);
	VERTEX.x += s * sway * h;
	VERTEX.z += cos(TIME * speed * 0.8 + wp.x) * sway * 0.6 * h;
}

void fragment() {
	vec3 c = pow(COLOR.rgb, vec3(2.2));
	ALBEDO = c;
	ROUGHNESS = 0.8;
	BACKLIGHT = c * 0.35;
}
