import { PERMISSION_APPS_SETTINGS_VIEW } from "@/models/permissions/app.permission"
import {
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
} from "@/models/permissions/course.permission"
import { PERMISSION_COURSES_CREATE } from "@/models/permissions/courses.permissions"
import { Role } from "@/models/permissions/permissions.model"
import { getCollection } from "./database.service"

const ADMIN_PERMISSIONS = [
  PERMISSION_APPS_SETTINGS_VIEW,
  PERMISSION_COURSES_CREATE,
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
]

const INSTRUCTOR_PERMISSIONS = [
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
]

const initPermissions = async () => {
  const collection = await getCollection<Role>("roles")

  await collection.updateOne(
    { name: "Global Admin" },
    {
      $set: {
        permissions: ADMIN_PERMISSIONS,
        description: "Global Admin role with all permissions",
        scope: "*",
      },
    },
    {
      upsert: true,
    }
  )

  await collection.updateOne(
    { name: "Instructor" },
    {
      $set: {
        permissions: INSTRUCTOR_PERMISSIONS,
        description: "Instructor role with limited permissions",
        scope: "course",
      },
    },
    {
      upsert: true,
    }
  )
}

export const getAllRoles = async () => {
  await initPermissions()
  const collection = await getCollection<Role>("roles")
  return collection.find({}, { projection: { _id: 0 } }).toArray()
}
