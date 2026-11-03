/**
 * One key per thing someone is creating: made when the form opens, sent with every try, and
 * replaced once it succeeded. The server answers a repeated key with the first answer, so a
 * double click or a retry after a timeout never creates two.
 */
export class IdempotencyKey {
  private key = crypto.randomUUID();

  get value(): string {
    return this.key;
  }

  /** After a success: the next submit creates something new. */
  renew(): void {
    this.key = crypto.randomUUID();
  }
}
