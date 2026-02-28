const API_BASE = "https://api.dicebear.com/9.x/glass/svg";

export interface AvatarOptions {
  backgroundColor?: string;
  size?: number;
  flip?: boolean;
  gradient?: boolean;
}

function stringToHex(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function pickColor(seed: string, colors: string[]): string {
  const hash = stringToHex(seed);
  const index = parseInt(hash.slice(0, 8), 16) % colors.length;
  return colors[index];
}

const BG_COLORS = [
  "1e293b",
  "312e81",
  "4c1d95",
  "581c87",
  "7c2d12",
  "713f12",
  "365314",
  "1e3a5f",
  "3b0764",
  "4a044e",
];

export function generateAvatarUrl(
  seed: string,
  options: AvatarOptions = {},
): string {
  const {
    backgroundColor,
    size = 800,
    flip = false,
    gradient = true,
  } = options;

  const bgColor = backgroundColor || pickColor(seed + "-bg", BG_COLORS);

  const params = new URLSearchParams({
    seed: seed,
    size: size.toString(),
    backgroundColor: bgColor,
    radius: "20",
  });

  if (gradient) {
    params.append("backgroundType", "gradientLinear");
  }

  if (flip) {
    params.append("flip", "true");
  }

  return `${API_BASE}?${params.toString()}`;
}
