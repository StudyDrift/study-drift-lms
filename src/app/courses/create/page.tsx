"use client"
import { RootPage } from "@/components/root-page"
import { PERMISSION_COURSES_CREATE } from "@/models/permissions/courses.permissions"
import { useCreateCourseMutation } from "@/redux/services/course.api"
import { useCreateOutcomesMutation } from "@/redux/services/outcome.api"
import {
  Button,
  Card,
  IconButton,
  Input,
  Textarea,
  Typography,
} from "@material-tailwind/react"
import { TrashIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

export default function Page() {
  const [name, setName] = useState<string>("")
  const [code, setCode] = useState<string>("")
  const [description, setDescription] = useState<string>("")
  const [outcomes, setOutcomes] = useState<string[]>([""])

  const router = useRouter()

  const [createOutcomes, { isLoading: isCreatingOutcomes }] =
    useCreateOutcomesMutation()

  const [createCourse, { isLoading: isCreatingCourse }] =
    useCreateCourseMutation()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const { data: result } = await createOutcomes(
      outcomes.filter((o) => o).map((o) => ({ outcome: o }))
    )

    const { data: course } = await createCourse({
      name,
      code,
      description,
      outcomeIds: result!.map((r) => r.id),
      meta: {},
      settings: {
        dates: {},
      },
    })

    setName("")
    setCode("")
    setDescription("")
    setOutcomes([""])

    router.push("/courses/" + course?.id)
  }

  return (
    <RootPage title="Create Course" permission={PERMISSION_COURSES_CREATE}>
      <div className="flex justify-center items-center h-full">
        <Card color="transparent" shadow={false}>
          <div className="max-w-screen-lg">
            <Typography variant="h4" color="blue-gray">
              Course Creation
            </Typography>
            <Typography variant="small">
              Create a simple container for your course. Don&apos;t worry, you
              can change this later.
            </Typography>
          </div>
          <div className="mt-8 mb-10 max-w-screen-lg">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="Course Name"
                onChange={(e) => setName(e.target.value)}
                value={name}
                crossOrigin={"anonymous"}
                autoFocus
                placeholder="Introduction to Computer Science"
              />
              <Input
                label="Course Code"
                onChange={(e) => setCode(e.target.value)}
                value={code}
                crossOrigin={"anonymous"}
                placeholder="CS 101"
              />
              <Textarea
                label="Course Description"
                onChange={(e) => setDescription(e.target.value)}
                value={description}
              ></Textarea>

              <div>
                <Typography variant="h6" color="blue-gray">
                  Course Outcomes
                </Typography>
                <Typography
                  variant="small"
                  color="gray"
                  className="max-w-lg mb-4"
                >
                  Course outcomes are the purpose for your course. What will the
                  students hope to gain. You should keep this short and to the
                  point.
                </Typography>
                <div className="grid gap-4">
                  {outcomes.map((o, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        label={`Outcome ${i + 1}`}
                        onChange={(e) => {
                          const newOutcomes = [...outcomes]
                          newOutcomes[i] = e.target.value

                          // If it's the last one, add a blank one at the end
                          if (i === outcomes.length - 1) {
                            newOutcomes.push("")
                          }

                          setOutcomes(newOutcomes)
                        }}
                        value={o}
                        crossOrigin={"anonymous"}
                        placeholder="Solve novel problems by building correct and functional software programs"
                      />
                      <IconButton
                        variant="text"
                        disabled={i === 0}
                        onClick={() =>
                          setOutcomes([
                            ...outcomes.slice(0, i),
                            ...outcomes.slice(i + 1),
                          ])
                        }
                      >
                        <TrashIcon className="w-4 h-4" />
                      </IconButton>
                    </div>
                  ))}
                </div>
                <Button
                  fullWidth
                  className="mt-6"
                  loading={isCreatingOutcomes || isCreatingCourse}
                  type="submit"
                >
                  Create Course
                </Button>
              </div>
            </form>
          </div>
        </Card>
      </div>
    </RootPage>
  )
}
