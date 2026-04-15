import { LmsPage } from './lms/LmsPage'

export default function TermsOfUsePage() {
  return (
    <LmsPage title="Terms of use">
      <div className="mt-6 max-w-prose text-sm text-slate-600 dark:text-neutral-400">
        <p>
          Terms of use for this product will be published here. Until then, use of Lextures is subject to
          agreements between your organization and Lextures.
        </p>
      </div>
    </LmsPage>
  )
}
