import { bootstrapApplication } from '@angular/platform-browser';
import { loadPolyfills } from '@openstuff-dev/ui/polyfills';
import { App } from './app/app';
import { appConfig } from './app/app.config';

// Popovers, invoker commands and anchor positioning where the browser lacks them.
void loadPolyfills();
bootstrapApplication(App, appConfig).catch((err: unknown) => {
  console.error(err);
});
