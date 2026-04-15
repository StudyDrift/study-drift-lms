import { LmsPage } from './lms/LmsPage'

export default function PrivacyPolicyPage() {
  return (
    <LmsPage title="Privacy policy">
      <div className="mt-6 max-w-prose text-sm text-slate-600 dark:text-neutral-400">
        <p>
          The privacy policy for this product will be published here. For questions about data handling,
          contact your administrator or Lextures support.
        </p>
      </div>
    </LmsPage>
  )
}
