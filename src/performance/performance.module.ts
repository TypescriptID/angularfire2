import { isPlatformBrowser } from '@angular/common';
import {
  EnvironmentProviders,
  InjectionToken,
  Injector,
  NgModule,
  NgZone,
  Optional,
  PLATFORM_ID,
  makeEnvironmentProviders,
} from '@angular/core';
import { VERSION, ɵAngularFireSchedulers, ɵgetDefaultInstanceOf } from '@angular/fire';
import { FirebaseApp, FirebaseApps } from '@angular/fire/app';
import { registerVersion } from 'firebase/app';
import { FirebasePerformance } from 'firebase/performance';
import { PERFORMANCE_PROVIDER_NAME, Performance, PerformanceInstances } from './performance';

export const PROVIDED_PERFORMANCE_INSTANCES = new InjectionToken<Performance[]>('angularfire2.performance-instances');

export function defaultPerformanceInstanceFactory(
  provided: FirebasePerformance[]|undefined,
  defaultApp: FirebaseApp,
  // eslint-disable-next-line @typescript-eslint/ban-types
  platform: Object
) {
  if (!isPlatformBrowser(platform)) { return null; }
  const defaultPerformance = ɵgetDefaultInstanceOf<FirebasePerformance>(PERFORMANCE_PROVIDER_NAME, provided, defaultApp);
  return defaultPerformance && new Performance(defaultPerformance);
}

export function performanceInstanceFactory(fn: (injector: Injector) => FirebasePerformance) {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return (zone: NgZone, platform: Object, injector: Injector) => {
    if (!isPlatformBrowser(platform)) { return null; }
    const performance = zone.runOutsideAngular(() => fn(injector));
    return new Performance(performance);
  };
}

const PERFORMANCE_INSTANCES_PROVIDER = {
  provide: PerformanceInstances,
  deps: [
    [new Optional(), PROVIDED_PERFORMANCE_INSTANCES ],
  ]
};

const DEFAULT_PERFORMANCE_INSTANCE_PROVIDER = {
  provide: Performance,
  useFactory: defaultPerformanceInstanceFactory,
  deps: [
    [new Optional(), PROVIDED_PERFORMANCE_INSTANCES ],
    FirebaseApp,
    PLATFORM_ID,
  ]
};

@NgModule({
  providers: [
    DEFAULT_PERFORMANCE_INSTANCE_PROVIDER,
    PERFORMANCE_INSTANCES_PROVIDER,
  ]
})
export class PerformanceModule {
  constructor() {
    registerVersion('angularfire', VERSION.full, 'perf');
  }
}

export function providePerformance(
  fn: (injector: Injector) => FirebasePerformance, ...deps: any[]
): EnvironmentProviders {
  registerVersion('angularfire', VERSION.full, 'perf');

  return makeEnvironmentProviders([
    DEFAULT_PERFORMANCE_INSTANCE_PROVIDER,
    PERFORMANCE_INSTANCES_PROVIDER,
    {
      provide: PROVIDED_PERFORMANCE_INSTANCES,
      useFactory: performanceInstanceFactory(fn),
      multi: true,
      deps: [
        NgZone,
        PLATFORM_ID,
        Injector,
        ɵAngularFireSchedulers,
        FirebaseApps,
        ...deps,
      ]
    }
  ]);
}
