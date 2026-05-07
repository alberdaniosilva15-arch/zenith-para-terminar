function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

export function normalizeAngolanPhone(value: string): string | null {
  const digits = digitsOnly(value);
  if (!digits) return null;

  const localNumber = digits.startsWith('244') ? digits.slice(3) : digits;
  if (!/^9\d{8}$/.test(localNumber)) {
    return null;
  }

  return `+244${localNumber}`;
}

export function isValidAngolanPhone(value: string): boolean {
  return normalizeAngolanPhone(value) !== null;
}
