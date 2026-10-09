// The /store route: the store's shelves under the site's page chrome. The
// shelves themselves live in components/StoreShelves.tsx, shared with the
// dialog.
import { Trans } from "@lingui/react/macro";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { SiteHeader } from "@/components/SiteHeader";
import { Storefront } from "@/lib/icons";
import { CosmeticGallery } from "@/components/CosmeticGallery";
import { StoreContent } from "@/components/StoreShelves";

export function Store() {
  return (
    <StoreContent>
      {(body, seatCol) => (
        <CosmeticGallery seatColor={seatCol}>
          <Screen>
            <SiteHeader active="store" compact />
            <PageBody>
              <PageTitle
                icon={<Storefront weight="bold" size={26} className="text-on-background" />}
                title={<Trans context="page title of the cosmetics shop">Store</Trans>}
                subtitle={<Trans>Cosmetics only. Nothing here touches the game.</Trans>}
              />
              {body}
            </PageBody>
          </Screen>
        </CosmeticGallery>
      )}
    </StoreContent>
  );
}
