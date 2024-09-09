"use client"
import { RootPage } from "@/components/root-page"
import { Skeleton } from "@/components/ui/skeleton"
import { toTitleCase } from "@/lib/casing"
import {
  getRoleParts,
  Permission,
} from "@/models/permissions/permissions.model"
import { useGetAllRolesQuery } from "@/redux/services/roles.api"
import {
  Accordion,
  AccordionBody,
  Button,
  Card,
  CardBody,
  List,
  ListItem,
  Typography,
} from "@material-tailwind/react"
import Link from "next/link"
import { useState } from "react"

export default function Page() {
  const { data: roles, isLoading: isLoadingRoles } = useGetAllRolesQuery()
  const [open, setOpen] = useState("")

  const roleParts = (permission: Permission) => {
    const parts = getRoleParts(permission)

    return (
      <div className="flex flex-row gap-8 w-full">
        <span className="w-44">
          <strong>Service:</strong> {toTitleCase(parts.service)}
        </span>
        <span className="w-44">
          <strong>Resource:</strong> {toTitleCase(parts.resource)}
        </span>
        <span>
          <strong>Action:</strong> {toTitleCase(parts.action)}
        </span>
      </div>
    )
  }

  return (
    <RootPage
      title="System - Roles and Permissions"
      isLoading={isLoadingRoles}
      actions={[
        <Link href={"/system/roles-and-permissions/add-role"} key="add-role">
          <Button>Add Role</Button>
        </Link>,
      ]}
    >
      <Card className="mt-8">
        <CardBody className="p-2">
          <Typography variant="h5">Available Roles</Typography>
          <List>
            {isLoadingRoles && <Skeleton className="w-full h-6" />}
            {roles?.map((role) => (
              <Accordion open={open === role.name} key={role.name}>
                <ListItem
                  key={role.name}
                  onClick={() => setOpen(open === role.name ? "" : role.name)}
                  ripple={false}
                >
                  {role.name} - {role.description}
                </ListItem>
                <AccordionBody className="pl-3">
                  <Typography>
                    <strong>Scope:</strong> {role.scope}
                  </Typography>
                  <List>
                    {role.permissions.map((permission) => (
                      <ListItem key={permission} ripple={false}>
                        {roleParts(permission)}
                      </ListItem>
                    ))}
                  </List>
                </AccordionBody>
              </Accordion>
            ))}
          </List>
        </CardBody>
      </Card>
    </RootPage>
  )
}
