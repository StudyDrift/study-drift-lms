import { useGetCourseRolesQuery } from "@/redux/services/roles.api"
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Option,
  Select,
} from "@material-tailwind/react"
import { useParams } from "next/navigation"
import { useState } from "react"

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const EnrollUserDialog = ({ isOpen, onClose }: Props) => {
  const { courseId } = useParams<{ courseId: string }>()
  const { data: roles } = useGetCourseRolesQuery(courseId, { skip: !courseId })

  const [role, setRole] = useState("")
  const [email, setEmail] = useState("")

  const handleEnroll = async () => {
    // TODO: Enroll user
  }

  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>Enroll User</DialogHeader>
      <DialogBody>
        <Select
          label="Select Role"
          value={role}
          onChange={(e) => setRole(e + "")}
        >
          {roles?.map((role) => (
            <Option key={role.name}>{role.name}</Option>
          ))}
        </Select>
        <div className="mt-4">
          <Input
            label="User Email or Comma Separated Emails"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="a@example.edu,b@example.edu,c@example.edu"
            crossOrigin={"anonymous"}
          />
        </div>
      </DialogBody>
      <DialogFooter className="space-x-2">
        <Button variant="text" onClick={onClose} className="mr-1">
          <span>Close</span>
        </Button>
        <Button onClick={handleEnroll} className="mr-1">
          <span>Enroll</span>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
