import type { ReactNode } from 'react'
import { UiDensityProvider } from '../../context/ui-density-context'
import { FeatureHelpProvider } from '../../context/feature-help-context'
import { ReducedDataProvider } from '../../context/reduced-data-context'
import { FeatureHelpDock } from '../feature-help/feature-help-dock'
import { RoleOnboardingTour } from '../onboarding/role-onboarding-tour'

export function LmsExperienceRoot({ children }: { children: ReactNode }) {
  return (
    <ReducedDataProvider>
      <UiDensityProvider>
        <FeatureHelpProvider>
          {children}
          <FeatureHelpDock />
          <RoleOnboardingTour />
        </FeatureHelpProvider>
      </UiDensityProvider>
    </ReducedDataProvider>
  )
}
