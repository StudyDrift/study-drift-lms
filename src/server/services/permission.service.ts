import { CommandContextOption } from "@/models/command.model"
import { PERMISSION_APPS_SETTINGS_VIEW } from "@/models/permissions/app.permission"
import {
  PERMISSION_COURSE_AI_CREATE,
  PERMISSION_COURSE_ANNOUNCEMENTS_CREATE,
  PERMISSION_COURSE_ANNOUNCEMENTS_DELETE,
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_DELETE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_ENROLLMENTS_CREATE,
  PERMISSION_COURSE_ENROLLMENTS_DELETE,
  PERMISSION_COURSE_ENROLLMENTS_VIEW,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_OUTCOMES_CREATE,
  PERMISSION_COURSE_SETTINGS_VIEW,
  PERMISSION_COURSE_SYLLABUS_UPDATE,
} from "@/models/permissions/course.permission"
import { PERMISSION_COURSES_CREATE } from "@/models/permissions/courses.permissions"
import { PERMISSION_GLOBAL_ALL_ROLES_VIEW } from "@/models/permissions/global.permission"
import { getRoleParts, Role } from "@/models/permissions/permissions.model"
import { getCacheItem, setCacheItem } from "./cache.service"
import { getCollection } from "./database.service"
import { getEnrollmentByUserAndCourse } from "./enrollment.service"
import { getUserRole } from "./user.service"

const INSTRUCTOR_PERMISSIONS = [
  PERMISSION_COURSE_CONTENT_CREATE,
  PERMISSION_COURSE_CONTENT_UPDATE,
  PERMISSION_COURSE_CONTENT_DELETE,
  PERMISSION_COURSE_GRADEBOOK_VIEW,
  PERMISSION_COURSE_SETTINGS_VIEW,
  PERMISSION_COURSE_ANNOUNCEMENTS_CREATE,
  PERMISSION_COURSE_ANNOUNCEMENTS_DELETE,
  PERMISSION_COURSE_OUTCOMES_CREATE,
  PERMISSION_COURSE_SYLLABUS_UPDATE,
  PERMISSION_COURSE_ENROLLMENTS_VIEW,
  PERMISSION_COURSE_ENROLLMENTS_CREATE,
  PERMISSION_COURSE_ENROLLMENTS_DELETE,
  PERMISSION_COURSE_AI_CREATE,
]

const ADMIN_PERMISSIONS = [
  PERMISSION_APPS_SETTINGS_VIEW,
  PERMISSION_COURSES_CREATE,
  PERMISSION_GLOBAL_ALL_ROLES_VIEW,
  ...INSTRUCTOR_PERMISSIONS,
]

const STUDENT_PERMISSIONS = [PERMISSION_COURSE_GRADEBOOK_VIEW]

export const initPermissions = async () => {
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

export const getScopedRoles = async (scope: string) => {
  const cacheKey = `roles:${scope}`
  const cache = await getCacheItem<Role[]>(cacheKey)

  if (cache) return cache

  const collection = await getCollection<Role>("roles")
  const roles = await collection
    .find({ scope }, { projection: { _id: 0 } })
    .toArray()

  await setCacheItem(cacheKey, roles)

  return roles
}

export const getRoles = async (
  roles: Array<{ name: string; scope: string }>
) => {
  const collection = await getCollection<Role>("roles")

  // Find by role and scope
  return collection.find({ $or: roles }, { projection: { _id: 0 } }).toArray()
}

export const getUserPermissions = async (
  userId: string,
  options: CommandContextOption
) => {
  const cacheKey = `permissions:${userId}:${options.courseId}`
  const cache = await getCacheItem<Role[]>(cacheKey)

  if (cache) return cache.flatMap((role) => role.permissions)

  const user = await getUserRole(userId)

  const roleParams = [{ name: user?.role ?? "Student", scope: "*" }]

  if (options.courseId) {
    const enrollment = await getEnrollmentByUserAndCourse(
      userId,
      options.courseId
    )

    if (enrollment) {
      roleParams.push({ name: enrollment.role, scope: "course" })
    }
  }

  const roles = await getRoles(roleParams)

  await setCacheItem(cacheKey, roles, 1000 * 60)

  return roles.flatMap((role) => role.permissions)
}

export const getMaxRoleLevels = async (userRole: string, scope: string) => {
  const roles = await getScopedRoles(scope)

  const currentRole = roles.find((role) => role.name === userRole)

  if (!currentRole) return []

  const currentRoleLevel = getRoleLevel(currentRole)
  return roles.filter(
    (role) => role.name !== userRole && getRoleLevel(role) <= currentRoleLevel
  )
}

const getRoleLevel = (role: Role) => {
  /**
   * Level: 0 - View
   * Level: 1 - Create
   * Level: 2 - Update
   * Level: 3 - Delete
   *
   * Get the current role level
   */

  const permissionActions = role.permissions.map(
    (permission) => getRoleParts(permission).action
  )

  if (permissionActions.includes("Delete")) return 3
  if (permissionActions.includes("Update")) return 2
  if (permissionActions.includes("Create")) return 1
  if (permissionActions.includes("View")) return 0

  return 0
}
