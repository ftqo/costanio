package cosmetics

import "math"

// hexToLab converts an "#rrggbb" sRGB color to CIE L*a*b* (D65). Panics on a
// malformed hex; palette colors are compile-time constants, so that is a
// programmer error.
func hexToLab(hex string) [3]float64 {
	r, g, b := hexToRGB(hex)
	// sRGB -> linear.
	lin := func(c float64) float64 {
		if c <= 0.04045 {
			return c / 12.92
		}
		return math.Pow((c+0.055)/1.055, 2.4)
	}
	rl, gl, bl := lin(r), lin(g), lin(b)
	// linear sRGB -> XYZ (D65).
	x := rl*0.4124 + gl*0.3576 + bl*0.1805
	y := rl*0.2126 + gl*0.7152 + bl*0.0722
	z := rl*0.0193 + gl*0.1192 + bl*0.9505
	// XYZ -> Lab, D65 reference white.
	const xn, yn, zn = 0.95047, 1.0, 1.08883
	f := func(t float64) float64 {
		if t > 216.0/24389.0 {
			return math.Cbrt(t)
		}
		return t*(841.0/108.0) + 4.0/29.0
	}
	fx, fy, fz := f(x/xn), f(y/yn), f(z/zn)
	return [3]float64{116*fy - 16, 500 * (fx - fy), 200 * (fy - fz)}
}

func hexToRGB(hex string) (r, g, b float64) {
	if len(hex) == 7 && hex[0] == '#' {
		hex = hex[1:]
	}
	if len(hex) != 6 {
		panic("cosmetics: bad hex color " + hex)
	}
	val := func(c byte) float64 {
		switch {
		case c >= '0' && c <= '9':
			return float64(c - '0')
		case c >= 'a' && c <= 'f':
			return float64(c-'a') + 10
		case c >= 'A' && c <= 'F':
			return float64(c-'A') + 10
		}
		panic("cosmetics: bad hex digit in " + hex)
	}
	byteAt := func(i int) float64 { return (val(hex[i])*16 + val(hex[i+1])) / 255 }
	return byteAt(0), byteAt(2), byteAt(4)
}

// DeltaE2000 is the CIE ΔE 2000 perceptual distance between two L*a*b* colors.
// ~1 is the just-noticeable difference; the package gates in-game color picks at
// ColorThreshold.
func DeltaE2000(lab1, lab2 [3]float64) float64 {
	const d2r = math.Pi / 180
	L1, a1, b1 := lab1[0], lab1[1], lab1[2]
	L2, a2, b2 := lab2[0], lab2[1], lab2[2]

	C1 := math.Hypot(a1, b1)
	C2 := math.Hypot(a2, b2)
	avgC := (C1 + C2) / 2
	p7 := func(x float64) float64 { return math.Pow(x, 7) }
	g := 0.5 * (1 - math.Sqrt(p7(avgC)/(p7(avgC)+p7(25))))

	a1p := a1 * (1 + g)
	a2p := a2 * (1 + g)
	C1p := math.Hypot(a1p, b1)
	C2p := math.Hypot(a2p, b2)

	hp := func(b, ap float64) float64 {
		if b == 0 && ap == 0 {
			return 0
		}
		h := math.Atan2(b, ap) * 180 / math.Pi
		if h < 0 {
			h += 360
		}
		return h
	}
	h1p := hp(b1, a1p)
	h2p := hp(b2, a2p)

	dLp := L2 - L1
	dCp := C2p - C1p

	var dhp float64
	switch {
	case C1p*C2p == 0:
		dhp = 0
	case math.Abs(h2p-h1p) <= 180:
		dhp = h2p - h1p
	case h2p-h1p > 180:
		dhp = h2p - h1p - 360
	default:
		dhp = h2p - h1p + 360
	}
	dHp := 2 * math.Sqrt(C1p*C2p) * math.Sin(dhp/2*d2r)

	avgLp := (L1 + L2) / 2
	avgCp := (C1p + C2p) / 2
	var avghp float64
	switch {
	case C1p*C2p == 0:
		avghp = h1p + h2p
	case math.Abs(h1p-h2p) > 180:
		avghp = (h1p + h2p + 360) / 2
	default:
		avghp = (h1p + h2p) / 2
	}

	T := 1 - 0.17*math.Cos((avghp-30)*d2r) + 0.24*math.Cos((2*avghp)*d2r) +
		0.32*math.Cos((3*avghp+6)*d2r) - 0.20*math.Cos((4*avghp-63)*d2r)
	dTheta := 30 * math.Exp(-(avghp-275)/25*((avghp-275)/25))
	Rc := 2 * math.Sqrt(p7(avgCp)/(p7(avgCp)+p7(25)))
	Sl := 1 + (0.015*(avgLp-50)*(avgLp-50))/math.Sqrt(20+(avgLp-50)*(avgLp-50))
	Sc := 1 + 0.045*avgCp
	Sh := 1 + 0.015*avgCp*T
	Rt := -math.Sin(2*dTheta*d2r) * Rc

	return math.Sqrt(
		dLp/Sl*(dLp/Sl) +
			dCp/Sc*(dCp/Sc) +
			dHp/Sh*(dHp/Sh) +
			Rt*(dCp/Sc)*(dHp/Sh))
}
