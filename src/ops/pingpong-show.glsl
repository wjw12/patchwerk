uniform float uExposure; // @range 0 4 default 1.6 label "Exposure"

// Tone-maps the ping-pong buffers for display.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 col = texture(iChannel0, fragCoord / iResolution.xy).rgb;
  col = 1.0 - exp(-col * uExposure);
  fragColor = vec4(pow(col, vec3(0.85)), 1.0);
}
