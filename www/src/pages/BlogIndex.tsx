import { ArrowLeft, ArrowRight, BookOpen, Search } from 'lucide-react'
import { useState, useMemo, useEffect, type ChangeEvent } from 'react'
import { Header } from '../components/Header'
import { allPosts, formatDate } from '../utils/blog'

const POSTS_PER_PAGE = 10

export function BlogIndex() {
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [currentPage])

  const filteredPosts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim()
    if (!query) return allPosts

    return allPosts.filter(
      (post) =>
        post.title.toLowerCase().includes(query) ||
        post.description.toLowerCase().includes(query) ||
        post.author.toLowerCase().includes(query) ||
        post.content.toLowerCase().includes(query)
    )
  }, [searchQuery])

  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE)
  const paginatedPosts = useMemo(() => {
    const start = (currentPage - 1) * POSTS_PER_PAGE
    return filteredPosts.slice(start, start + POSTS_PER_PAGE)
  }, [filteredPosts, currentPage])

  // Reset to first page when search query changes
  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value)
    setCurrentPage(1)
  }

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

            <div className="mt-10 max-w-md">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Search className="h-4 w-4 text-stone-400" aria-hidden />
                </div>
                <input
                  type="text"
                  placeholder="Search articles..."
                  className="block w-full rounded-lg border border-stone-200 bg-stone-50 py-2.5 pl-10 pr-3 text-sm placeholder-stone-400 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent"
                  value={searchQuery}
                  onChange={handleSearchChange}
                />
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            {filteredPosts.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-lg text-stone-500">No posts found matching your search.</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 text-sm font-semibold text-accent hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <>
                <div className="divide-y divide-stone-200/80">
                  {paginatedPosts.map((post) => (
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

                {totalPages > 1 && (
                  <nav className="mt-16 flex items-center justify-between border-t border-stone-200 pt-8" aria-label="Pagination">
                    <div className="flex flex-1 justify-between sm:hidden">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="btn-secondary px-4 py-2 disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="btn-secondary px-4 py-2 disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                    <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm text-stone-500">
                          Showing <span className="font-medium">{(currentPage - 1) * POSTS_PER_PAGE + 1}</span> to{' '}
                          <span className="font-medium">
                            {Math.min(currentPage * POSTS_PER_PAGE, filteredPosts.length)}
                          </span>{' '}
                          of <span className="font-medium">{filteredPosts.length}</span> results
                        </p>
                      </div>
                      <div>
                        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                          <button
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="relative inline-flex items-center rounded-l-md px-2 py-2 text-stone-400 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                          >
                            <span className="sr-only">Previous</span>
                            <ArrowLeft className="h-5 w-5" aria-hidden />
                          </button>
                          {[...Array(totalPages)].map((_, i) => {
                            const pageNumber = i + 1
                            // Simple logic to show current, first, last, and neighbors
                            if (
                              totalPages > 7 &&
                              pageNumber !== 1 &&
                              pageNumber !== totalPages &&
                              Math.abs(pageNumber - currentPage) > 1
                            ) {
                              if (Math.abs(pageNumber - currentPage) === 2) {
                                return <span key={pageNumber} className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-stone-400 ring-1 ring-inset ring-stone-200 focus:outline-offset-0">...</span>
                              }
                              return null
                            }

                            return (
                              <button
                                key={pageNumber}
                                onClick={() => setCurrentPage(pageNumber)}
                                aria-current={currentPage === pageNumber ? 'page' : undefined}
                                className={`relative inline-flex items-center px-4 py-2 text-sm font-semibold focus:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                                  currentPage === pageNumber
                                    ? 'z-10 bg-accent text-white focus-visible:outline-accent'
                                    : 'text-stone-900 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 focus:outline-offset-0'
                                }`}
                              >
                                {pageNumber}
                              </button>
                            )
                          })}
                          <button
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="relative inline-flex items-center rounded-r-md px-2 py-2 text-stone-400 ring-1 ring-inset ring-stone-200 hover:bg-stone-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                          >
                            <span className="sr-only">Next</span>
                            <ArrowRight className="h-5 w-5" aria-hidden />
                          </button>
                        </nav>
                      </div>
                    </div>
                  </nav>
                )}
              </>
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
