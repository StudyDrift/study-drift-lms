import { CommandContextOption } from "@/models/command.model"
import { PERMISSION_APPS_SETTINGS_VIEW } from "@/models/permissions/app.permission"
import {
  PERMISSION_COURSE_ANNOUNCEMENTS_CREATE,
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
} from "@/models/permissions/course.permission"
import { PERMISSION_COURSES_CREATE } from "@/models/permissions/courses.permissions"
import { Role } from "@/models/permissions/permissions.model"
import { getCollection } from "./database.service"
import { getEnrollmentByUserAndCourse } from "./enrollment.service"
import { getUserRole } from "./user.service"

const INSTRUCTOR_PERMISSIONS = [
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
  PERMISSION_COURSE_ANNOUNCEMENTS_CREATE,
]

const ADMIN_PERMISSIONS = [
  PERMISSION_APPS_SETTINGS_VIEW,
  PERMISSION_COURSES_CREATE,
  ...INSTRUCTOR_PERMISSIONS,
]

const STUDENT_PERMISSIONS = [PERMISSION_COURSE_GRADEBOOK_VIEW]

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

  await collection.updateOne(
    { name: "Owner" },
    {
      $set: {
        permissions: INSTRUCTOR_PERMISSIONS,
        description: "Owner role with all permissions for a course",
        scope: "course",
      },
    },
    {
      upsert: true,
    }
  )

  await collection.updateOne(
    { name: "Student" },
    {
      $set: {
        permissions: STUDENT_PERMISSIONS,
        description: "Student role with limited permissions",
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

export const getRoles = async (
  roles: Array<{ role: string; scope: string }>
) => {
  const collection = await getCollection<Role>("roles")

  return collection.find({ $or: roles }, { projection: { _id: 0 } }).toArray()
}

export const getUserPermissions = async (
  userId: string,
  options: CommandContextOption
) => {
  const user = await getUserRole(userId)

  const roleParams = [{ role: user?.role ?? "Student", scope: "*" }]

  if (options.courseId) {
    const enrollment = await getEnrollmentByUserAndCourse(
      userId,
      options.courseId
    )

    if (enrollment) {
      roleParams.push({ role: enrollment.role, scope: "course" })
    }
  }

  const roles = await getRoles(roleParams)

  return roles.flatMap((role) => role.permissions)
}
