import { Course } from "@/models/course.model"
import { Card, CardBody, Typography } from "@material-tailwind/react"
import Link from "next/link"

interface Props {
  course: Course
  dragHandle: React.ReactNode
}

export const CourseCard = ({ course, dragHandle }: Props) => {
  return (
    <Link href={`/courses/${course.id}`}>
      <Card className="min-h-32 w-96 relative hover:shadow-lg cursor-pointer">
        <div className="mt-2 ml-2 mb-2">{dragHandle}</div>
        <CardBody className="mt-0 pt-0">
          <Typography variant="small">{course.code}</Typography>
          <Typography variant="h5">{course.name}</Typography>
          <Typography>{course.description}</Typography>
        </CardBody>
      </Card>
    </Link>
  )
}
