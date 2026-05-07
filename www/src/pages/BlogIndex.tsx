import { ArrowRight, BookOpen } from 'lucide-react'
import { Header } from '../components/Header'
import { allPosts, formatDate } from '../utils/blog'

export function BlogIndex() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-stone-50 text-slate-700">
      <Header />

      <main>
        <section className="border-b border-stone-200/90 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-muted/70 text-accent">
                <BookOpen className="h-5 w-5" aria-hidden />
              </div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-stone-500">
                Lextures Blog
              </p>
            </div>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
              Writing
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-stone-600">
              Thoughts on adaptive learning, educational technology, and building software for institutions that run at scale.
            </p>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            {allPosts.length === 0 ? (
              <p className="text-stone-500">No posts yet.</p>
            ) : (
              <div className="divide-y divide-stone-200/80">
                {allPosts.map((post) => (
                  <article key={post.slug} className="group py-10 first:pt-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
                      <div className="flex-1">
                        <time
                          dateTime={post.date}
                          className="text-xs font-medium uppercase tracking-widest text-stone-400"
                        >
                          {formatDate(post.date)}
                        </time>
                        <h2 className="mt-2 text-xl font-semibold leading-snug text-stone-900 sm:text-2xl">
                          <a
                            href={`#/blog/${post.slug}`}
                            className="no-underline transition-colors hover:text-accent"
                          >
                            {post.title}
                          </a>
                        </h2>
                        <p className="mt-3 max-w-2xl text-base leading-relaxed text-stone-600">
                          {post.description}
                        </p>
                        <p className="mt-2 text-sm text-stone-400">By {post.author}</p>
                      </div>
                      <a
                        href={`#/blog/${post.slug}`}
                        className="btn-primary shrink-0 gap-2 self-start"
                        aria-label={`Read ${post.title}`}
                      >
                        Read
                        <ArrowRight className="h-4 w-4" aria-hidden />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200/90 bg-white py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <p className="text-sm text-stone-400">© {new Date().getFullYear()} Lextures contributors</p>
        </div>
      </footer>
    </div>
  )
}
