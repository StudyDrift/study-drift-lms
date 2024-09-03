interface Props {
  className?: string
}

export const Spinner = ({ className }: Props = {}) => {
  return <div className={"loader " + className}></div>
}
