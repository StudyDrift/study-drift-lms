import type { ReactNode } from 'react'
import { UiDensityProvider } from '../../context/ui-density-context'
import { FeatureHelpProvider } from '../../context/feature-help-context'
import { ReducedDataProvider } from '../../context/reduced-data-context'
import { FeatureHelpDock } from '../feature-help/feature-help-dock'

export function LmsExperienceRoot({ children }: { children: ReactNode }) {
  return (
    <ReducedDataProvider>
      <UiDensityProvider>
        <FeatureHelpProvider>
          {children}
          <FeatureHelpDock />
        </FeatureHelpProvider>
      </UiDensityProvider>
    </ReducedDataProvider>
  )
}
