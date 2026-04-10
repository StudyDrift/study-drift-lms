import './BookLoader.css'

type BookLoaderProps = {
  className?: string
}

/**
 * Book flip loader (animation adapted from a Dribbble shot; see BookLoader.css).
 */
export function BookLoader({ className }: BookLoaderProps) {
  return (
    <div className={className ? `quiz-book-loader ${className}` : 'quiz-book-loader'} aria-hidden>
      <div className="inner">
        <div className="left" />
        <div className="middle" />
        <div className="right" />
      </div>
      <ul>
        {Array.from({ length: 18 }, (_, i) => (
          <li key={i} />
        ))}
      </ul>
    </div>
  )
}
