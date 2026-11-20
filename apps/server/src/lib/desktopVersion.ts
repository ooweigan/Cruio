export function isDesktopVersion(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){2,3}$/.test(value) &&
    value.split(".").every(part => Number.isSafeInteger(Number(part)));
}

export function compareDesktopVersions(left: string, right: string): number {
  if (!isDesktopVersion(left) || !isDesktopVersion(right)) throw new Error("无效的桌面版本号");
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 4; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
