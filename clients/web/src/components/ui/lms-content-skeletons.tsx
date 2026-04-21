/** Pulse placeholders for first-paint loading on heavy LMS views. */

function Shimmer({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-slate-200/90 dark:bg-neutral-700/75 ${className}`}
      aria-hidden
    />
  )
}

function LiveRegion({ children }: { children: string }) {
  return <span className="sr-only">{children}</span>
}

export function DashboardLoadingSkeleton() {
  return (
    <div className="mt-8 space-y-10" aria-busy="true">
      <LiveRegion>Loading your dashboard.</LiveRegion>
      <div className="flex flex-wrap gap-3">
        <Shimmer className="h-10 w-36 rounded-xl" />
        <Shimmer className="h-10 w-32 rounded-xl" />
        <Shimmer className="h-10 w-44 rounded-xl" />
      </div>
      <div>
        <Shimmer className="h-3 w-24" />
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <Shimmer className="h-3 w-48" />
          <Shimmer className="mt-3 h-6 w-3/4 max-w-md" />
          <Shimmer className="mt-5 h-10 w-32 rounded-xl" />
        </div>
      </div>
      <div>
        <Shimmer className="h-3 w-20" />
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-2">
              <Shimmer className="h-5 w-40" />
              <Shimmer className="h-3 w-56" />
            </div>
            <Shimmer className="h-8 w-36 rounded-full" />
          </div>
          <ul className="mt-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <li
                key={i}
                className="flex flex-col gap-2 rounded-xl border border-slate-100 px-3 py-3 dark:border-neutral-800 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <Shimmer className="h-3 w-28" />
                  <Shimmer className="h-4 w-full max-w-sm" />
                  <Shimmer className="h-3 w-44" />
                </div>
                <Shimmer className="h-6 w-24 rounded-full sm:shrink-0" />
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <Shimmer className="h-5 w-2/3 max-w-xs" />
              <Shimmer className="mt-4 h-3 w-40" />
              <Shimmer className="mt-2 h-8 w-24" />
              <div className="mt-4 flex flex-wrap gap-2">
                <Shimmer className="h-8 w-24 rounded-lg" />
                <Shimmer className="h-8 w-20 rounded-lg" />
                <Shimmer className="h-8 w-24 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CoursesCatalogSkeleton() {
  return (
    <div className="mt-8" aria-busy="true">
      <LiveRegion>Loading courses.</LiveRegion>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <Shimmer className="h-40 w-full rounded-none" />
            <div className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-4">
              <Shimmer className="h-4 w-full max-w-[280px]" />
              <Shimmer className="h-4 w-full max-w-[240px]" />
              <Shimmer className="h-4 w-full max-w-[180px]" />
              <Shimmer className="mt-1 h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GradebookLoadingSkeleton() {
  const colPlaceholders = Array.from({ length: 6 })
  const rowPlaceholders = Array.from({ length: 10 })
  return (
    <div className="mt-6 space-y-3" aria-busy="true">
      <LiveRegion>Loading gradebook.</LiveRegion>
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900/50">
        <div className="flex min-w-[10rem] flex-1 flex-col gap-2">
          <Shimmer className="h-3 w-16" />
          <Shimmer className="h-10 w-full rounded-lg" />
        </div>
        <div className="flex min-w-[10rem] flex-1 flex-col gap-2">
          <Shimmer className="h-3 w-20" />
          <Shimmer className="h-10 w-full rounded-lg" />
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <div className="min-w-max">
          <div className="flex border-b border-slate-200 bg-slate-50 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="sticky left-0 z-10 flex w-48 shrink-0 items-end border-r border-slate-200 bg-slate-50 px-3 py-3 dark:border-neutral-700 dark:bg-neutral-800">
              <Shimmer className="h-4 w-20" />
            </div>
            <div className="flex w-20 shrink-0 items-end border-r border-slate-200 bg-slate-50 px-2 py-3 dark:border-neutral-700 dark:bg-neutral-800">
              <Shimmer className="h-3 w-10" />
            </div>
            {colPlaceholders.map((_, i) => (
              <div
                key={i}
                className="flex w-36 shrink-0 items-end border-r border-slate-200 bg-slate-50 px-2 py-3 last:border-r-0 dark:border-neutral-700 dark:bg-neutral-800"
              >
                <Shimmer className="h-8 w-full" />
              </div>
            ))}
          </div>
          {rowPlaceholders.map((_, ri) => (
            <div
              key={ri}
              className="flex border-b border-slate-100 last:border-b-0 dark:border-neutral-800"
            >
              <div className="sticky left-0 z-10 w-48 shrink-0 border-r border-slate-200 bg-white px-3 py-2.5 dark:border-neutral-700 dark:bg-neutral-900">
                <Shimmer className="h-4 w-32" />
              </div>
              <div className="flex w-20 shrink-0 items-center border-r border-slate-200 px-2 py-2 dark:border-neutral-700">
                <Shimmer className="mx-auto h-4 w-10" />
              </div>
              {colPlaceholders.map((_, ci) => (
                <div
                  key={ci}
                  className="flex w-36 shrink-0 items-center border-r border-slate-200 px-2 py-2 last:border-r-0 dark:border-neutral-700"
                >
                  <Shimmer className="mx-auto h-4 w-14 rounded-sm" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CourseModulesLoadingSkeleton() {
  return (
    <div className="mt-8 space-y-3" aria-busy="true">
      <LiveRegion>Loading modules.</LiveRegion>
      {Array.from({ length: 4 }).map((_, mi) => (
        <div
          key={mi}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <div className="flex items-center gap-3">
            <Shimmer className="h-8 w-8 rounded-md" />
            <Shimmer className="h-5 flex-1 max-w-xs" />
            <Shimmer className="h-8 w-20 rounded-lg" />
          </div>
          <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3 dark:border-neutral-800">
            {Array.from({ length: 3 }).map((_, ci) => (
              <li key={ci} className="flex items-center gap-3 pl-4 sm:pl-8">
                <Shimmer className="h-7 w-7 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Shimmer className="h-4 w-48 max-w-full" />
                  <Shimmer className="h-3 w-32 max-w-full" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
