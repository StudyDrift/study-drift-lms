import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "@material-tailwind/react"
import { PropsWithChildren } from "react"

interface Props extends PropsWithChildren {
  isOpen: boolean
  onConfirm: () => void
  onClose: () => void
  isConfirmLoading?: boolean
}

export const AreYouSureDialog = ({
  onConfirm,
  children,
  isOpen,
  onClose,
  isConfirmLoading,
}: Props) => {
  return (
    <Dialog open={isOpen} handler={onClose}>
      <DialogHeader>Are you sure?</DialogHeader>
      <DialogBody>{children}</DialogBody>
      <DialogFooter>
        <Button
          variant="text"
          color="red"
          onClick={onConfirm}
          className="mr-1"
          loading={isConfirmLoading}
        >
          <span>Yes</span>
        </Button>
        <Button variant="text" color="blue" onClick={onClose}>
          <span>No</span>
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
