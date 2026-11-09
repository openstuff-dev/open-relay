import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SectionHeader, SettingCard, SettingCardBody, ThemePicker } from '@openstuff-dev/ui-angular';

/** The light or dark choice. It's kept in this browser, not on the server. */
@Component({
  selector: 'app-appearance',
  imports: [SectionHeader, SettingCard, SettingCardBody, ThemePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'stack' },
  template: `
    <header
      os-section-header
      title="Appearance"
      description="Stored in this browser only. Other devices keep their own choice."
    ></header>

    <section os-setting-card title="Theme" description="System follows your device's setting.">
      <div os-setting-card-body><os-theme-picker label="Theme" /></div>
    </section>
  `,
})
export class Appearance {}
