import { z } from "zod";

// Jira cevapları sık genişler; bilinmeyen alanlar korunur (looseObject), yalnızca kullanılanlar doğrulanır.

export const MyselfSchema = z.looseObject({
  accountId: z.string(),
  displayName: z.string(),
  emailAddress: z.string().optional(),
  timeZone: z.string().optional(),
  avatarUrls: z.record(z.string(), z.string()).optional(),
});
export type Myself = z.infer<typeof MyselfSchema>;

export const PermissionsSchema = z.looseObject({
  permissions: z.record(
    z.string(),
    z.looseObject({ key: z.string(), name: z.string().optional(), havePermission: z.boolean() }),
  ),
});

export const FieldSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  custom: z.boolean(),
  schema: z
    .looseObject({
      type: z.string(),
      items: z.string().optional(),
      custom: z.string().optional(),
    })
    .optional(),
});
export type JiraField = z.infer<typeof FieldSchema>;
export const FieldListSchema = z.array(FieldSchema);

export const StatusSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  statusCategory: z.looseObject({ key: z.string(), name: z.string().optional() }).optional(),
});
export type JiraStatus = z.infer<typeof StatusSchema>;
export const StatusListSchema = z.array(StatusSchema);

/** GET /project/{key}/statuses: issue tipi başına statü listesi */
export const ProjectStatusesSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    statuses: z.array(StatusSchema),
  }),
);

export const ProjectSchema = z.looseObject({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});
export type JiraProject = z.infer<typeof ProjectSchema>;

export const SearchPageSchema = z.looseObject({
  issues: z.array(
    z.looseObject({
      id: z.string(),
      key: z.string(),
      fields: z.record(z.string(), z.unknown()).default({}),
    }),
  ),
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().optional(),
});
export type SearchIssue = z.infer<typeof SearchPageSchema>["issues"][number];

export const UserRefSchema = z.looseObject({
  accountId: z.string(),
  displayName: z.string().optional(),
  avatarUrls: z.record(z.string(), z.string()).optional(),
});
export type UserRef = z.infer<typeof UserRefSchema>;

export const ProjectSearchPageSchema = z.looseObject({
  values: z.array(
    z.looseObject({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      simplified: z.boolean().optional(),
      avatarUrls: z.record(z.string(), z.string()).optional(),
    }),
  ),
  isLast: z.boolean().optional(),
  total: z.number().optional(),
});

export const TransitionsSchema = z.looseObject({
  transitions: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      to: StatusSchema,
      fields: z
        .record(
          z.string(),
          z.looseObject({
            required: z.boolean(),
            hasDefaultValue: z.boolean().optional(),
            name: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
});
export type JiraTransition = z.infer<typeof TransitionsSchema>["transitions"][number];

export const EditMetaSchema = z.looseObject({
  fields: z.record(z.string(), z.looseObject({ required: z.boolean().optional(), name: z.string().optional() })),
});

export const CommentSchema = z.looseObject({
  id: z.string(),
  author: UserRefSchema.optional(),
  created: z.string().optional(),
  properties: z.array(z.looseObject({ key: z.string(), value: z.unknown() })).optional(),
});

export const CommentPageSchema = z.looseObject({
  comments: z.array(CommentSchema),
  startAt: z.number().optional(),
  maxResults: z.number().optional(),
  total: z.number().optional(),
});

export const VersionSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  released: z.boolean(),
  archived: z.boolean().optional(),
  releaseDate: z.string().optional(),
  startDate: z.string().optional(),
  overdue: z.boolean().optional(),
  projectId: z.number().optional(),
});
export type JiraVersion = z.infer<typeof VersionSchema>;

export const VersionPageSchema = z.looseObject({
  values: z.array(VersionSchema),
  isLast: z.boolean().optional(),
});

export const ChangelogBulkSchema = z.looseObject({
  issueChangeLogs: z
    .array(
      z.looseObject({
        issueId: z.string(),
        changeHistories: z
          .array(
            z.looseObject({
              created: z.union([z.string(), z.number()]),
              author: z.looseObject({ accountId: z.string() }).nullish(),
              items: z.array(
                z.looseObject({ fieldId: z.string().optional(), field: z.string().optional(), from: z.string().nullish(), to: z.string().nullish() }),
              ),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().nullish(),
});
