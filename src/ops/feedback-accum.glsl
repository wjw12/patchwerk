// @feedback

// Feedback precision probe. Each frame adds (x / width) / 4096 to red, so after
// N frames red should read N * x / (width * 4096) exactly: a ramp that keeps
// rising. A half-float buffer rounds the small steps away and the ramp stalls
// in bands. Green is a static vertical ramp so the test frame is not flat.

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float prev = texelFetch(iChannel3, ivec2(fragCoord), 0).r;
  float step = (fragCoord.x / iResolution.x) / 4096.0;
  fragColor = vec4(prev + step, fragCoord.y / iResolution.y * 0.25, 0.0, 1.0);
}
