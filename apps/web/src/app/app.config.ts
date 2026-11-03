import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  provideRouter,
  withComponentInputBinding,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      // Pages under /n/:network get `network` as an input.
      withRouterConfig({ paramsInheritanceStrategy: 'always' }),
      // Short cross-fades between pages; none with reduced motion (see styles.css).
      withViewTransitions({ skipInitialTransition: true }),
    ),
  ],
};
