import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { IconButton, Icon, Toaster } from '@openstuff-dev/ui-angular';
import { iconCopy } from './icons';

/** Copies `text` and says so in a toast. */
@Component({
  selector: 'app-copy-button',
  imports: [IconButton, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      os-icon-button
      variant="ghost"
      size="sm"
      [label]="'Copy ' + what()"
      (click)="copy()"
    >
      <svg os-icon [icon]="icon" size="sm"></svg>
    </button>
  `,
})
export class CopyButton {
  readonly text = input.required<string>();
  /** What's copied, for the button's name and the toast: "public key". */
  readonly what = input.required<string>();
  private readonly toaster = inject(Toaster);
  protected readonly icon = iconCopy;

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text());
      this.toaster.show(`Copied the ${this.what()}.`, { tone: 'success' });
    } catch {
      this.toaster.show('Your browser didn’t allow copying. Select the text instead.', { tone: 'warning' });
    }
  }
}
