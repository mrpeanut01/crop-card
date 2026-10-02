/** Plain-English text for a refused amendments request: the server's
 *  `message`, else the first field issue, else a generic line. */
export async function responseMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as {
    error?: string;
    message?: string;
    issues?: Array<{ message?: string }>;
  } | null;
  if (body?.message) return body.message;
  if (body?.issues?.[0]?.message) return body.issues[0].message;
  if (res.status === 403) return 'Only the owner can do that.';
  return `Something went wrong (HTTP ${res.status}).`;
}

export const OFFLINE_TEXT = "We couldn't reach CropCard. Check your signal and try again.";
