// Clockwork Neon -- a ShaderToy-style paste test.
// Exercises: #define macros (with args), const arrays, inout, int iFrame,
// iDate, texelFetch / textureLod on iChannel0, iChannelResolution,
// iMouse, integer fragCoord math, a 300-step march behind a macro bound.
// The tick-mark loop was a `while` as pasted; the loop guard rejects those.

#define PI 3.14159265359
#define TAU (2.0 * PI)
#define saturate(x) clamp(x, 0.0, 1.0)
#define R iResolution.xy
#define MARCH_STEPS 300
#define GEARS 5

const vec3 PALETTE[4] = vec3[4](
    vec3(1.00, 0.35, 0.20),
    vec3(0.20, 0.85, 1.00),
    vec3(1.00, 0.85, 0.30),
    vec3(0.70, 0.40, 1.00));

const float TEETH[GEARS] = float[GEARS](12.0, 8.0, 16.0, 6.0, 10.0);

void pR(inout vec2 p, float a) {
    p = cos(a) * p + sin(a) * vec2(p.y, -p.x);
}

float sdGear(vec2 p, float r, float teeth, float a) {
    pR(p, a);
    float ang = atan(p.y, p.x);
    float tooth = smoothstep(-0.3, 0.3, sin(ang * teeth)) * 0.12 * r;
    float d = length(p) - (r + tooth);
    return max(d, -(length(p) - r * 0.35));
}

float hand(vec2 p, float a, float len, float w) {
    pR(p, -a);
    p.y -= len * 0.5;
    vec2 q = abs(p) - vec2(w, len * 0.5);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

// Classic sphere-traced orb behind the clock, 300 steps on purpose.
float orb(vec3 p) {
    float d = length(p) - 1.0;
    d += 0.05 * sin(6.0 * p.x + iTime) * sin(6.0 * p.y) * sin(6.0 * p.z - iTime);
    return d;
}

vec3 march(vec2 uv) {
    vec3 ro = vec3(0.0, 0.0, -3.2);
    vec3 rd = normalize(vec3(uv, 1.6));
    float t = 0.0;
    for (int i = 0; i < MARCH_STEPS; i++) {
        float d = orb(ro + rd * t);
        if (d < 0.001 || t > 8.0) break;
        t += d * 0.5;
    }
    if (t > 8.0) return vec3(0.0);
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.001, 0.0);
    vec3 n = normalize(vec3(orb(p + e.xyy) - orb(p - e.xyy), orb(p + e.yxy) - orb(p - e.yxy), orb(p + e.yyx) - orb(p - e.yyx)));
    float fres = pow(1.0 - saturate(-dot(n, rd)), 3.0);
    return PALETTE[1] * fres * 0.8 + PALETTE[3] * 0.08;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv = (fragCoord - 0.5 * R) / R.y;

    // background: blurred input via textureLod, dithered with texelFetch
    vec2 tuv = fragCoord / R;
    vec3 bg = textureLod(iChannel0, tuv, 3.0).rgb * 0.35;
    ivec2 ip = ivec2(fragCoord) % ivec2(iChannelResolution[0].xy);
    bg += texelFetch(iChannel0, ip, 0).rgb * 0.05;

    vec3 col = bg + march(uv * 1.2);

    // gears -- the mouse drags the whole train
    vec2 m = iMouse.xy == vec2(0.0) ? vec2(0.0) : (iMouse.xy - 0.5 * R) / R.y;
    float spin = iTime * 0.6;
    for (int i = 0; i < GEARS; i++) {
        float fi = float(i);
        vec2 c = 0.62 * vec2(cos(fi * TAU / float(GEARS)), sin(fi * TAU / float(GEARS))) + m * 0.2;
        float dir = (i % 2 == 0) ? 1.0 : -1.0;
        float d = sdGear(uv - c, 0.16, TEETH[i], dir * spin * 12.0 / TEETH[i]);
        col = mix(col, PALETTE[i % 4] * 0.6, smoothstep(0.004, 0.0, d));
        col += PALETTE[i % 4] * 0.012 / (abs(d) + 0.01);
    }

    // clock hands from iDate.w (seconds since midnight)
    float secs = iDate.w;
    float s = mod(secs, 60.0);
    float mi = mod(secs / 60.0, 60.0);
    float h = mod(secs / 3600.0, 12.0);
    float dh = hand(uv, TAU * h / 12.0, 0.22, 0.012);
    float dm = hand(uv, TAU * mi / 60.0, 0.34, 0.008);
    float ds = hand(uv, TAU * floor(s) / 60.0, 0.4, 0.003);
    col = mix(col, vec3(1.0), smoothstep(0.003, 0.0, min(dh, dm)));
    col = mix(col, PALETTE[0], smoothstep(0.003, 0.0, ds));

    // tick marks
    for (int k = 0; k < 12; k++) {
        vec2 q = uv;
        pR(q, float(k) * TAU / 12.0);
        float tick = length(max(abs(q - vec2(0.0, 0.43)) - vec2(0.004, 0.025), 0.0));
        col += vec3(0.9) * smoothstep(0.003, 0.0, tick);
    }

    // pixel-exact frame: left/bottom column must be fragCoord < 1.0
    if (fragCoord.x < 1.0 || fragCoord.y < 1.0 || fragCoord.x > R.x - 1.0 || fragCoord.y > R.y - 1.0) col = PALETTE[2];

    // first frame flash and odd-frame scanline shimmer, both int iFrame
    if (iFrame == 0) col = vec3(1.0);
    if ((iFrame + int(fragCoord.y)) % 2 == 1) col *= 0.97;

    fragColor = vec4(col, 1.0);
}
