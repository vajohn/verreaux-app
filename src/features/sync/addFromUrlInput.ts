export interface AddFromUrlFields {
  url: string;
  otp: string;
  from: string;
  to: string;
  /** True when this device is enrolled for sync. Enrolled devices authorize the
   *  scrape with their device token, so the OTP is not required. */
  enrolled: boolean;
}

export type ValidatedAddFromUrl =
  | { ok: true; url: string; otp: string; from: string; to: string }
  | { ok: false; error: string };

/** Validate the add-from-URL sheet inputs. The OTP is only required when the
 *  device is NOT enrolled — an enrolled device scrapes via its device token
 *  (see `tokenRunScrape`), so it must not be blocked on a 6-digit code. */
export function validateAddFromUrlInput(f: AddFromUrlFields): ValidatedAddFromUrl {
  const url = f.url.trim();
  const otp = f.otp.trim();
  const from = f.from.trim();
  const to = f.to.trim();
  if (!url) return { ok: false, error: 'Enter a series URL.' };
  if (!f.enrolled && !/^\d{6}$/.test(otp)) {
    return { ok: false, error: 'Enter the 6-digit authenticator code.' };
  }
  if (from && !/^\d+$/.test(from)) {
    return { ok: false, error: '"From" must be a chapter number, or leave it blank for the start.' };
  }
  if (to && to !== 'latest' && !/^\d+$/.test(to)) {
    return { ok: false, error: '"To" must be a number or "latest", or leave it blank.' };
  }
  return { ok: true, url, otp, from, to };
}
