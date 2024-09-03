"use client"
import { RootPage } from "@/components/root-page"
import { Button, Typography } from "@material-tailwind/react"
import { FlagIcon } from "lucide-react"
import Link from "next/link"

export default function Page() {
  return (
    <RootPage>
      <div className="h-screen mx-auto grid place-items-center text-center px-8">
        <div>
          <FlagIcon className="w-20 h-20 mx-auto" />
          <Typography
            variant="h1"
            color="blue-gray"
            className="mt-10 !text-3xl !leading-snug md:!text-4xl"
          >
            Unauthorized <br /> It looks like you don&apos;t belong here.
          </Typography>
          <Typography className="mt-8 mb-14 text-[18px] font-normal text-gray-500 mx-auto md:max-w-sm">
            If you think this is an error, please contact your administrator.
          </Typography>
          <Link href="/">
            <Button color="gray" className="w-full px-4 md:w-[8rem]">
              back home
            </Button>
          </Link>
        </div>
      </div>
    </RootPage>
  )
}
