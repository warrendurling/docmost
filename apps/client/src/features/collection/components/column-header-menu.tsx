import { ActionIcon, Menu } from "@mantine/core";
import {
  IconChevronDown,
  IconPencil,
  IconTrash,
  IconPlus,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import {
  useCreatePropertyMutation,
  useDeletePropertyMutation,
  useUpdatePropertyMutation,
  useUpdateViewMutation,
} from "@/features/collection/queries/collection-query";
import {
  CollectionPropertyType,
  CreatablePropertyType,
  ICollectionView,
} from "@/features/collection/services/collection-service";

const NEW_COLUMN_TYPES: { type: CreatablePropertyType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "select", label: "Select" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkbox" },
];

interface ColumnHeaderMenuProps {
  collectionPageId: string;
  viewId: string;
  viewConfig: ICollectionView["config"];
  property: { id: string; name: string; type: CollectionPropertyType };
}

export function ColumnHeaderMenu({
  collectionPageId,
  viewId,
  viewConfig,
  property,
}: ColumnHeaderMenuProps) {
  // Primary (title) column can't be renamed, deleted, or type-changed [R9/R10].
  const isPrimary = property.type === "title";

  const updateProperty = useUpdatePropertyMutation(collectionPageId);
  const deleteProperty = useDeletePropertyMutation(collectionPageId);
  const createProperty = useCreatePropertyMutation(collectionPageId);
  const updateView = useUpdateViewMutation(collectionPageId);

  const handleRename = () => {
    const next = window.prompt("Rename column", property.name);
    const trimmed = next?.trim();
    if (trimmed && trimmed !== property.name) {
      updateProperty.mutate({ id: property.id, name: trimmed });
    }
  };

  const handleDelete = () => {
    if (window.confirm(`Delete column "${property.name}"? This cannot be undone.`)) {
      deleteProperty.mutate({ id: property.id });
    }
  };

  const handleInsert = (type: CreatablePropertyType, label: string) => {
    createProperty.mutate({ name: label, type });
  };

  const handleSort = (direction: "asc" | "desc") => {
    updateView.mutate({
      id: viewId,
      config: { ...viewConfig, sorts: [{ propertyId: property.id, direction }] },
    });
  };

  return (
    <Menu withinPortal position="bottom-end" shadow="md">
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Column menu"
          onClick={(e) => e.stopPropagation()}
        >
          <IconChevronDown size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {!isPrimary && (
          <Menu.Item leftSection={<IconPencil size={14} />} onClick={handleRename}>
            Rename
          </Menu.Item>
        )}
        <Menu.Item
          leftSection={<IconSortAscending size={14} />}
          onClick={() => handleSort("asc")}
        >
          Sort ascending
        </Menu.Item>
        <Menu.Item
          leftSection={<IconSortDescending size={14} />}
          onClick={() => handleSort("desc")}
        >
          Sort descending
        </Menu.Item>
        <Menu.Sub>
          <Menu.Sub.Target>
            <Menu.Sub.Item leftSection={<IconPlus size={14} />}>
              Insert column
            </Menu.Sub.Item>
          </Menu.Sub.Target>
          <Menu.Sub.Dropdown>
            {NEW_COLUMN_TYPES.map((t) => (
              <Menu.Item key={t.type} onClick={() => handleInsert(t.type, t.label)}>
                {t.label}
              </Menu.Item>
            ))}
          </Menu.Sub.Dropdown>
        </Menu.Sub>
        {!isPrimary && (
          <>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={handleDelete}
            >
              Delete
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
